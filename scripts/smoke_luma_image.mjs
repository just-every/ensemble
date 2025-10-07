#!/usr/bin/env node
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensembleImage } from '../dist/index.js';
import { saveImageUnknown } from './_smoke_utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.LUMA_API_KEY) {
    console.log('Skipping Luma smoke: LUMA_API_KEY not set');
    return;
  }
  const prompt = process.argv.slice(2).join(' ') || 'An ultra-detailed photograph of a hummingbird in flight';
  const agent = { name: 'smoke-luma', model: 'luma-photon-1', tags: ['smoke','image'] };
  console.log('Generating with Luma Photon…');
  const images = await ensembleImage(prompt, agent, { size: 'landscape' });
  if (!images?.length) throw new Error('No images returned');
  const outBase = path.resolve(__dirname, '../data/luma_photon_smoke');
  const saved = await saveImageUnknown(images[0], outBase);
  console.log('Saved:', saved);
}

main().catch(err => { console.error('Luma smoke failed:', err?.response?.data || err); process.exit(1); });

