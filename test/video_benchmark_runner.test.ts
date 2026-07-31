import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    assertDistinctModelOutputDirectories,
    claimFreshOutputDirectory,
    extractMediaFraming,
    runModelsInParallel,
} from '../scripts/benchmark_video.mjs';

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-video-benchmark-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('video benchmark runner', () => {
    it('launches independent model jobs before awaiting their results', async () => {
        const started: string[] = [];
        let release;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });

        const pending = runModelsInParallel(['model-a', 'model-b', 'model-c'], async model => {
            started.push(model);
            await gate;
            return `${model}-complete`;
        });

        expect(started).toEqual(['model-a', 'model-b', 'model-c']);
        release();
        await expect(pending).resolves.toEqual(['model-a-complete', 'model-b-complete', 'model-c-complete']);
    });

    it('rejects model IDs that would write into the same evidence directory', () => {
        expect(() => assertDistinctModelOutputDirectories(['provider/model', 'provider_model'])).toThrow(
            /same evidence directory/
        );
    });

    it('extracts display framing while retaining the encoded pixel aspect', () => {
        expect(
            extractMediaFraming({
                streams: [
                    {
                        codec_type: 'video',
                        width: 1440,
                        height: 1080,
                        sample_aspect_ratio: '4:3',
                        display_aspect_ratio: '16:9',
                    },
                ],
            })
        ).toEqual({
            width: 1440,
            height: 1080,
            aspect_ratio: '16:9',
            storage_aspect_ratio: '4:3',
            pixel_aspect_ratio: '4:3',
        });
    });

    it('rejects an output directory containing evidence from an earlier run', () => {
        const parent = temporaryDirectory();
        const output = path.join(parent, 'benchmark-output');
        fs.mkdirSync(path.join(output, 'old-model'), { recursive: true });
        fs.writeFileSync(path.join(output, 'old-model', 'evidence.json'), '{}\n');

        expect(() => claimFreshOutputDirectory(output)).toThrow(/not empty.*prior evidence/i);
        expect(fs.existsSync(path.join(output, '.video-benchmark-active'))).toBe(false);
    });

    it('exclusively claims a new output directory', () => {
        const parent = temporaryDirectory();
        const output = path.join(parent, 'benchmark-output');

        const claim = claimFreshOutputDirectory(output);

        expect(fs.readFileSync(claim, 'utf8')).toBe(`${process.pid}\n`);
        expect(() => claimFreshOutputDirectory(output)).toThrow(/not empty.*prior evidence/i);
    });
});
