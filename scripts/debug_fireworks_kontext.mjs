import 'dotenv/config';
const key = process.env.FIREWORKS_API_KEY;
if (!key) { console.error('No FIREWORKS_API_KEY'); process.exit(1); }
const model = process.argv[2] || 'flux-kontext-pro';
const createUrl = `https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/${model}`;
const r = await fetch(createUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ prompt: 'A watercolor hummingbird', output_format: 'png' }),
});
const data = await r.json().catch(()=>({error:true}));
console.log('create status', r.status, data);
const id = data.request_id || data.id;
if (!id) process.exit(2);
const pollUrl = `https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/${model}/get_result`;
const started = Date.now();
while (true) {
  const p = await fetch(pollUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ id }) });
  const out = await p.json().catch(()=>({json:false}));
  console.log('poll', p.status, out.status, Object.keys(out||{}));
  if (out?.result) {
    console.log('result keys', Object.keys(out.result));
    console.log('result', JSON.stringify(out.result).slice(0,400));
  }
  if ((out?.status||'').toLowerCase().includes('ready') || (out?.result && (out?.result?.images || out?.result?.image || out?.result?.url))) break;
  if (Date.now() - started > 90000) break;
  await new Promise(r=>setTimeout(r,1500));
}
