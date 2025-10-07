#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensembleImage, MODEL_REGISTRY } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, '..', '.artifacts', 'smoke-images');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function toSafe(name) { return String(name).replace(/[^a-z0-9-_.]/gi, '_'); }

function decodeDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], data: Buffer.from(m[2], 'base64') };
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || 'application/octet-stream';
  return { mime: ct.split(';')[0], data: buf };
}

async function saveImage(targetDir, baseName, image) {
  ensureDir(targetDir);
  let payload;
  if (typeof image === 'string' && image.startsWith('data:')) {
    payload = decodeDataUrl(image);
  } else if (typeof image === 'string' && /^https?:\/\//i.test(image)) {
    payload = await download(image);
  } else {
    return null;
  }
  const mt = payload.mime.toLowerCase();
  const ext = mt.includes('png') ? 'png' : mt.includes('jpeg') ? 'jpg' : mt.includes('webp') ? 'webp' : 'bin';
  const file = path.join(targetDir, `${toSafe(baseName)}.${ext}`);
  fs.writeFileSync(file, payload.data);
  return file;
}

function modelSupportsImageInput(modelId) {
  const entry = MODEL_REGISTRY.find(m => m.id === modelId);
  return Boolean(entry && entry.features && entry.features.input_modality && entry.features.input_modality.includes('image'));
}

const withTimeout = async (p, ms, label) => {
  let id; const to = new Promise((_, rej) => { id = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(id); }
};

async function main() {
  const modelId = process.argv[2];
  if (!modelId) {
    console.error('Usage: node scripts/smoke_one_image.mjs <model-id>');
    process.exit(2);
  }
  const modelDir = path.join(OUT_DIR, toSafe(modelId));
  const SLOW_MODELS = new Set(['midjourney-v7', 'flux-kontext-pro']);
  const TEXT_TIMEOUT = SLOW_MODELS.has(modelId) ? 300000 : 180000; // 5m for slow queues
  const I2I_TIMEOUT = TEXT_TIMEOUT;
  const basePrompt = 'A colorful watercolor hummingbird, detailed, soft lighting';
  const opts = { n: 1, size: 'square', response_format: 'url' };
  const result = { model: modelId, text: null, i2i: null };

  console.log(`Testing model ${modelId} (text-only)…`);
  try {
    const images = await withTimeout(ensembleImage(basePrompt, { model: modelId, agent_id: 'smoke-one' }, opts), TEXT_TIMEOUT, `${modelId} text`);
    const saved = await Promise.all(images.map((img, i) => saveImage(modelDir, `text_${i + 1}`, img)));
    result.text = { ok: true, count: images.length, files: saved };
    console.log('Text: ok', saved);
  } catch (err) {
    result.text = { ok: false, error: String(err?.message || err) };
    console.error('Text: fail', result.text.error);
  }

  if (modelSupportsImageInput(modelId)) {
    console.log(`Testing model ${modelId} (image-to-image)…`);
    // Use stable Unsplash images to avoid content-type mismatches
    const url1 = 'https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d?w=512';
    const url2 = 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=512';
    try {
      const images = await withTimeout(ensembleImage('Keep main composition but in watercolor style', { model: modelId, agent_id: 'smoke-one' }, { ...opts, source_images: [url1, url2] }), I2I_TIMEOUT, `${modelId} i2i`);
      const saved = await Promise.all(images.map((img, i) => saveImage(modelDir, `i2i_${i + 1}`, img)));
      result.i2i = { ok: true, count: images.length, files: saved };
      console.log('I2I: ok', saved);
    } catch (err) {
      result.i2i = { ok: false, error: String(err?.message || err) };
      console.error('I2I: fail', result.i2i.error);
    }
  } else {
    result.i2i = { ok: false, skipped: true, reason: 'no image input support' };
  }

  ensureDir(OUT_DIR);
  const outJson = path.join(OUT_DIR, `${toSafe(modelId)}.json`);
  fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
  console.log('Saved report:', outJson);
  process.exit(result.text?.ok ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
