import { createServer, type Server } from 'http';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexImageAttachmentWriter } from '../model_providers/codex_assets.js';

describe('Codex image attachment SSRF protection', () => {
    const tempDirs: string[] = [];
    const servers: Server[] = [];

    afterEach(async () => {
        await Promise.all(
            servers.splice(0).map(
                server =>
                    new Promise<void>((resolve, reject) => {
                        server.close(error => (error ? reject(error) : resolve()));
                    })
            )
        );
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function makeTempDir(): Promise<string> {
        const dir = await mkdtemp(path.join(tmpdir(), 'codex-assets-ssrf-'));
        tempDirs.push(dir);
        return dir;
    }

    async function listenLoopbackServer(onRequest: () => void): Promise<string> {
        const server = createServer((_req, res) => {
            onRequest();
            res.writeHead(200, { 'content-type': 'image/png' });
            res.end(Buffer.from('png'));
        });
        servers.push(server);

        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', reject);
                resolve();
            });
        });

        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Expected loopback server to have an address.');
        }
        return `http://127.0.0.1:${address.port}/image.png`;
    }

    it('blocks loopback input_image URLs before they reach the local server', async () => {
        let reachedServer = false;
        const imageUrl = await listenLoopbackServer(() => {
            reachedServer = true;
        });

        const writer = new CodexImageAttachmentWriter(await makeTempDir(), process.cwd());

        await expect(
            writer.collectContent(
                [
                    { type: 'input_text', text: 'Describe this image' },
                    { type: 'input_image', image_url: imageUrl },
                ],
                'test message'
            )
        ).rejects.toThrow('blocked unsafe image URL host');
        expect(reachedServer).toBe(false);
    });

    it.each([
        'http://10.0.0.5/image.png',
        'http://172.16.0.5/image.png',
        'http://192.168.0.5/image.png',
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]/image.png',
        'http://[fc00::1]/image.png',
        'http://[fe80::1]/image.png',
    ])('blocks private or local image URL %s', async imageUrl => {
        const writer = new CodexImageAttachmentWriter(await makeTempDir(), process.cwd());

        await expect(
            writer.collectContent([{ type: 'input_image', image_url: imageUrl }], 'test message')
        ).rejects.toThrow('blocked unsafe image URL host');
    });
});
