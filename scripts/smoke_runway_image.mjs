#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensembleImage } from '../dist/index.js';
import { costTracker } from '../dist/utils/cost_tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.RUNWAY_API_KEY) {
    console.error('Missing RUNWAY_API_KEY');
    process.exit(2);
  }
  const prompt = process.argv.slice(2).join(' ') || 'A modern abstract wallpaper, vibrant gradients (smoke)';
  const agent = { name: 'smoke-runway', model: 'runway-gen4-image', tags: ['smoke','image'] };
  console.log('Generating with Runway Gen-4 Image (official API)…');
  const urls = await ensembleImage(prompt, agent, { n: 1 });
  if (!urls?.length) throw new Error('No image URLs');
  const outDir = path.resolve(__dirname, '../data');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir,'runway_gen4_image_smoke.url.txt'), urls[0] + '\n');
  console.log('Saved URL:', urls[0]);
  console.log('Cost (approx): $' + costTracker.getTotalCost().toFixed(6));
}

main().catch(err => { console.error('Runway smoke failed:', err?.response?.data || err); process.exit(1); });

