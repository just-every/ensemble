#!/usr/bin/env node
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensembleImage } from '../dist/index.js';
import { saveImageUnknown } from './_smoke_utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const api = process.env.MIDJOURNEY_API_KEY || process.env.MJ_API_KEY || process.env.KIE_API_KEY;
  if (!api) {
    console.log('Skipping Midjourney smoke: MIDJOURNEY_API_KEY (or KIE_API_KEY) not set');
    return;
  }
  const prompt = process.argv.slice(2).join(' ') || 'A cinematic illustration of a cyberpunk alley, rain, neon';
  const agent = { name: 'smoke-mj', model: 'midjourney-v7', tags: ['smoke','image'] };
  console.log('Generating with Midjourney v7 (third-party)…');
  const images = await ensembleImage(prompt, agent, { size: 'landscape' });
  if (!images?.length) throw new Error('No images returned');
  const outBase = path.resolve(__dirname, '../data/midjourney_v7_smoke');
  const saved = await saveImageUnknown(images[0], outBase);
  console.log('Saved:', saved);
}

main().catch(err => { console.error('Midjourney smoke failed:', err?.response?.data || err); process.exit(1); });
