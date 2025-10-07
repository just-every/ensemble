#!/usr/bin/env node
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensembleImage } from '../dist/index.js';
import { saveImageUnknown } from './_smoke_utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.IDEOGRAM_API_KEY) {
    console.log('Skipping Ideogram smoke: IDEOGRAM_API_KEY not set');
    return;
  }
  const prompt = process.argv.slice(2).join(' ') || 'A minimalist logo for a tea shop, vector style';
  const agent = { name: 'smoke-ideogram', model: 'ideogram-3.0', tags: ['smoke','image'] };
  console.log('Generating with Ideogram 3.0…');
  const images = await ensembleImage(prompt, agent, { size: '1024x1024' });
  if (!images?.length) throw new Error('No images returned');
  const outBase = path.resolve(__dirname, '../data/ideogram_v3_smoke');
  const saved = await saveImageUnknown(images[0], outBase);
  console.log('Saved:', saved);
}

main().catch(err => { console.error('Ideogram smoke failed:', err?.response?.data || err); process.exit(1); });

