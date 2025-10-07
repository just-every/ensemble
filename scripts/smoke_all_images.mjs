#!/usr/bin/env node
import 'dotenv/config';
// DEPRECATED: bulk image smoke test
// -------------------------------------------------------------
// This script previously executed ALL image providers in one run.
// It is intentionally deprecated and should not be used because:
// - Cost control: running all providers at once can be expensive.
// - Reliability: a single misconfigured or failing provider can
//   block the entire run and prevent useful results.
// - Safety: we want explicit, one-by-one validation using real keys.
// Please use `scripts/smoke_one_image.mjs <model-id>` to test a single
// provider/model at a time, or the specific provider scripts, e.g.:
//   - npm run smoke:gemini:image
//   - npm run smoke:luma:image
//   - npm run smoke:ideogram:image
//   - npm run smoke:mj:image
// For targeted tests, see `scripts/smoke_one_image.mjs` which will:
//   - run text-to-image
//   - attempt image-to-image with multiple inputs when supported
// -------------------------------------------------------------

console.error('[deprecated] scripts/smoke_all_images.mjs has been intentionally disabled.');
console.error('Use: node scripts/smoke_one_image.mjs <model-id>');
process.exit(1);
