import fs from 'node:fs/promises';
import path from 'node:path';

export async function saveImageUnknown(data, outPathBase) {
  // data can be a data URL or an http(s) URL
  if (typeof data !== 'string') throw new Error('Unsupported image payload');
  if (data.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(data);
    if (!m) throw new Error('Unexpected data URL');
    const [, mime, b64] = m;
    const ext = (mime.split('/')[1] || 'png').split(';')[0];
    const outPath = `${outPathBase}.${ext}`;
    await fs.writeFile(outPath, Buffer.from(b64, 'base64'));
    return outPath;
  }
  if (!/^https?:\/\//.test(data)) throw new Error('Unsupported image URL');
  const res = await fetch(data);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const ct = res.headers.get('content-type') || 'image/png';
  const ext = (ct.split('/')[1] || 'png').split(';')[0];
  const outPath = `${outPathBase}.${ext}`;
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
  return outPath;
}

