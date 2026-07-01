import { lookup } from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';

const MAX_CODEX_IMAGE_REDIRECTS = 3;

function ipv4ToNumber(address: string): number | undefined {
    const parts = address.split('.');
    if (parts.length !== 4) return undefined;

    let value = 0;
    for (const part of parts) {
        if (!/^\d+$/.test(part)) return undefined;
        const octet = Number(part);
        if (octet < 0 || octet > 255) return undefined;
        value = (value << 8) | octet;
    }
    return value >>> 0;
}

function isIpv4InCidr(address: string, range: string, prefixLength: number): boolean {
    const addressValue = ipv4ToNumber(address);
    const rangeValue = ipv4ToNumber(range);
    if (addressValue === undefined || rangeValue === undefined) return false;

    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
    return (addressValue & mask) === (rangeValue & mask);
}

function parseIpv6(address: string): bigint | undefined {
    const [head = '', tail = ''] = address.toLowerCase().split('::');
    if (address.split('::').length > 2) return undefined;

    function parsePart(part: string): number[] | undefined {
        if (!part) return [];

        const pieces = part.split(':');
        const groups: number[] = [];
        for (const piece of pieces) {
            if (piece.includes('.')) {
                const ipv4 = ipv4ToNumber(piece);
                if (ipv4 === undefined) return undefined;
                groups.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
                continue;
            }
            if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
            groups.push(parseInt(piece, 16));
        }
        return groups;
    }

    const headGroups = parsePart(head);
    const tailGroups = parsePart(tail);
    if (!headGroups || !tailGroups) return undefined;

    const missingGroups = 8 - headGroups.length - tailGroups.length;
    if ((address.includes('::') && missingGroups < 0) || (!address.includes('::') && missingGroups !== 0)) {
        return undefined;
    }

    const groups = [...headGroups, ...Array(Math.max(missingGroups, 0)).fill(0), ...tailGroups];
    if (groups.length !== 8) return undefined;

    return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function isIpv6InCidr(address: string, range: string, prefixLength: number): boolean {
    const addressValue = parseIpv6(address);
    const rangeValue = parseIpv6(range);
    if (addressValue === undefined || rangeValue === undefined) return false;

    const hostBits = BigInt(128 - prefixLength);
    return addressValue >> hostBits === rangeValue >> hostBits;
}

function mappedIpv4Address(address: string): string | undefined {
    const parsed = parseIpv6(address);
    if (parsed === undefined || parsed >> 32n !== 0xffffn) return undefined;

    return [24n, 16n, 8n, 0n].map(shift => Number((parsed >> shift) & 0xffn)).join('.');
}

function isPublicIpAddress(address: string): boolean {
    const family = net.isIP(address);
    if (family === 4) {
        return ![
            ['0.0.0.0', 8],
            ['10.0.0.0', 8],
            ['100.64.0.0', 10],
            ['127.0.0.0', 8],
            ['169.254.0.0', 16],
            ['172.16.0.0', 12],
            ['192.0.0.0', 24],
            ['192.0.2.0', 24],
            ['192.88.99.0', 24],
            ['192.168.0.0', 16],
            ['198.18.0.0', 15],
            ['198.51.100.0', 24],
            ['203.0.113.0', 24],
            ['224.0.0.0', 4],
            ['240.0.0.0', 4],
        ].some(([range, prefixLength]) => isIpv4InCidr(address, range as string, prefixLength as number));
    }

    if (family === 6) {
        const mapped = mappedIpv4Address(address);
        if (mapped) return isPublicIpAddress(mapped);

        return ![
            ['::', 128],
            ['::1', 128],
            ['::', 8],
            ['64:ff9b:1::', 48],
            ['100::', 64],
            ['2001::', 23],
            ['2001:db8::', 32],
            ['2002::', 16],
            ['fc00::', 7],
            ['fe80::', 10],
            ['ff00::', 8],
        ].some(([range, prefixLength]) => isIpv6InCidr(address, range as string, prefixLength as number));
    }

    return false;
}

async function resolvePublicAddress(url: URL): Promise<string> {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(hostname)
        ? [{ address: hostname }]
        : await lookup(hostname, { all: true, verbatim: true });
    const publicAddresses = addresses.filter(address => isPublicIpAddress(address.address));
    if (publicAddresses.length !== addresses.length || publicAddresses.length === 0) {
        throw new Error(`Codex provider blocked unsafe image URL host: ${hostname}`);
    }
    return publicAddresses[0].address;
}

export async function fetchCodexImageUrl(
    value: string,
    redirectCount = 0
): Promise<{ buffer: Buffer; contentType: string | undefined }> {
    if (redirectCount > MAX_CODEX_IMAGE_REDIRECTS) {
        throw new Error(`Codex provider image URL exceeded ${MAX_CODEX_IMAGE_REDIRECTS} redirects: ${value}`);
    }

    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Codex provider blocked unsupported image URL protocol: ${url.protocol}`);
    }

    const address = await resolvePublicAddress(url);
    const requestModule = url.protocol === 'https:' ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');

    return new Promise((resolve, reject) => {
        const request = requestModule.request(
            {
                protocol: url.protocol,
                hostname: address,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                headers: {
                    Host: url.host,
                },
                servername: hostname,
                timeout: 30000,
            },
            response => {
                const statusCode = response.statusCode || 0;
                if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                    response.resume();
                    const redirectUrl = new URL(response.headers.location, url);
                    fetchCodexImageUrl(redirectUrl.toString(), redirectCount + 1).then(resolve, reject);
                    return;
                }

                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.on('end', () => {
                    if (statusCode < 200 || statusCode >= 300) {
                        reject(
                            new Error(
                                `Codex provider failed to fetch image ${value}: ${statusCode} ${
                                    response.statusMessage || ''
                                }`.trim()
                            )
                        );
                        return;
                    }
                    resolve({
                        buffer: Buffer.concat(chunks),
                        contentType: response.headers['content-type'],
                    });
                });
            }
        );

        request.on('timeout', () => {
            request.destroy(new Error(`Codex provider timed out fetching image ${value}`));
        });
        request.on('error', reject);
        request.end();
    });
}
