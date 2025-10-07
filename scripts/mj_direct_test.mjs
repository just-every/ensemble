#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = process.env.MJ_API_BASE || 'https://api.kie.ai';
const API_KEY = process.env.MIDJOURNEY_API_KEY || process.env.KIE_API_KEY || process.env.MJ_API_KEY;

if (!API_KEY) {
  console.error('Missing MIDJOURNEY_API_KEY (or KIE_API_KEY)');
  process.exit(2);
}

const paramJson = {
  aspectRatio: '1:1',
  callBackUrl: '',
  enableTranslation: false,
  fileUrl: '',
  motion: 'high',
  prompt: 'a cat at the park',
  speed: 'fast',
  stylization: 100,
  taskType: 'mj_txt2img',
  variety: 0,
  version: '7',
  videoBatchSize: 1,
  waterMark: '',
  weirdness: 0,
};

async function main() {
  console.log('POST /api/v1/mj/generate');
  const genRes = await fetch(`${API_BASE}/api/v1/mj/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ paramJson: JSON.stringify(paramJson) }),
  });
  const genJson = await genRes.json().catch(async () => ({ code: genRes.status, msg: await genRes.text() }));
  console.log('generate response:', JSON.stringify(genJson, null, 2));
  if (!genRes.ok || (genJson?.code && genJson.code !== 200)) {
    console.error('Create error:', genJson?.msg || genRes.statusText);
    process.exit(1);
  }
  const taskId = genJson?.data?.taskId || genJson?.taskId || genJson?.id;
  if (!taskId) {
    console.error('No taskId in response');
    process.exit(1);
  }

  // Poll for up to 120s
  const start = Date.now();
  let info;
  let notFoundCount = 0;
  while (Date.now() - start < 120000) {
    const r = await fetch(`${API_BASE}/api/v1/mj/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    info = await r.json().catch(async () => ({ code: r.status, msg: await r.text() }));
    const code = info?.code ?? r.status;
    const status = info?.data?.status || info?.status;
    console.log('status:', status, 'code:', code);

    // Immediate failure on hard error codes
    if (code && code !== 200) {
      if (code === 404) {
        notFoundCount++;
        if (notFoundCount > 5) {
          console.error('Task not found repeatedly. Aborting.');
          process.exit(1);
        }
      } else {
        console.error('Polling error:', JSON.stringify(info, null, 2));
        process.exit(1);
      }
    }

    if (status === 'SUCCESS' || info?.successFlag === 1) break;
    if (status === 'FAILED' || info?.successFlag === 2) {
      console.error('Task failed:', JSON.stringify(info, null, 2));
      process.exit(1);
    }
    await new Promise(r2 => setTimeout(r2, 1000));
  }

  if (!info || !((info?.data?.status || info?.status) === 'SUCCESS' || info?.successFlag === 1)) {
    console.error('Did not reach SUCCESS within timeout');
    process.exit(1);
  }

  const list = info?.data?.resultInfoJson?.resultUrls || info?.resultInfoJson?.resultUrls || [];
  const urls = list.map(u => (typeof u === 'string' ? u : u?.resultUrl)).filter(Boolean);
  console.log('result urls (first):', urls[0]);

  if (urls[0]) {
    const res = await fetch(urls[0]);
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.resolve('data/mj_direct_smoke.jpeg');
    await fs.writeFile(out, buf);
    console.log('Saved:', out, `${buf.length} bytes`);
  }
}

main().catch(err => { console.error('Direct test failed:', err); process.exit(1); });
