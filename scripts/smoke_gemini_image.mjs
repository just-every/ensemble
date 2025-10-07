#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use built output to avoid TS compile step
import { ensembleImage } from '../dist/index.js';
import { costTracker } from '../dist/utils/cost_tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function saveDataUrl(dataUrl, outPath) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Unexpected image format');
  const [, mime, b64] = match;
  const ext = mime.split('/')[1] || 'png';
  const target = outPath.endsWith(ext) ? outPath : `${outPath}.${ext}`;
  await fs.writeFile(target, Buffer.from(b64, 'base64'));
  return target;
}

async function main() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('Missing GOOGLE_API_KEY in environment');
    process.exit(2);
  }

  const prompt = process.argv.slice(2).join(' ') || 'A banana wearing a superhero costume, studio lighting, 4k';

  const agent = {
    name: 'smoke-image',
    model: 'gemini-2.5-flash-image-preview',
    tags: ['smoke', 'image'],
  };

  console.log('Generating image with Gemini 2.5 Flash Image Preview …');
  const images = await ensembleImage(prompt, agent, { n: 1 });
  if (!images?.length) throw new Error('No images returned');

  const outDir = path.resolve(__dirname, '../data');
  await fs.mkdir(outDir, { recursive: true });
  const saved = await saveDataUrl(images[0], path.join(outDir, 'gemini_flash_image_preview_smoke'));
  console.log('Saved:', saved);

  const total = costTracker.getTotalCost();
  console.log(`Cost (approx): $${total.toFixed(6)}`);
}

main().catch(err => {
  console.error('Smoke test failed:', err?.response?.data || err);
  process.exit(1);
});
