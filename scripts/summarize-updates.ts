#!/usr/bin/env npx tsx
/**
 * Summarize the model updates for easy review
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function summarizeUpdates() {
  console.log('Model Data Update Summary - May 31, 2025');
  console.log('========================================\n');
  
  // Load the complete model data
  const dataPath = path.join(__dirname, '..', 'complete-model-data-may-2025.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
  
  // Group by provider
  const byProvider: Record<string, any[]> = {};
  for (const [id, model] of Object.entries(data.models)) {
    const provider = (model as any).provider;
    if (!byProvider[provider]) byProvider[provider] = [];
    byProvider[provider].push({ id, ...model as any });
  }
  
  // Print summary by provider
  for (const [provider, models] of Object.entries(byProvider)) {
    console.log(`${provider.toUpperCase()} (${models.length} models)`);
    console.log('-'.repeat(50));
    
    for (const model of models) {
      const cost = `$${model.cost.input}/$${model.cost.output}`;
      const context = `${(model.features.contextLength / 1000).toFixed(0)}K`;
      const features = [];
      if (model.features.supportsVision) features.push('👁️');
      if (model.features.supportsFunctions) features.push('🔧');
      if (model.embedding) features.push('📊');
      
      console.log(`  ${model.id}`);
      console.log(`    Cost: ${cost} | Context: ${context} | ${features.join(' ')}`);
      if (model.description) {
        console.log(`    ${model.description}`);
      }
      if (model.scores) {
        const scores = [];
        if (model.scores.code) scores.push(`Code: ${model.scores.code}%`);
        if (model.scores.reasoning) scores.push(`Reasoning: ${model.scores.reasoning}%`);
        if (scores.length > 0) {
          console.log(`    Benchmarks: ${scores.join(', ')}`);
        }
      }
      console.log();
    }
  }
  
  // Print rate limits summary
  console.log('\nRATE LIMITS SUMMARY');
  console.log('===================\n');
  
  if (data.rateLimits) {
    for (const [provider, limits] of Object.entries(data.rateLimits)) {
      console.log(`${provider.toUpperCase()}: ${(limits as any).notes || 'See detailed limits in report'}`);
    }
  }
  
  console.log('\n\nKEY HIGHLIGHTS');
  console.log('==============');
  console.log('• Claude 4 models: New hybrid reasoning with 32K output');
  console.log('• Gemini 2.5: Thinking capabilities, up to 2M context');
  console.log('• o3: Most expensive but highest benchmarks');
  console.log('• DeepSeek: Cache-based pricing saves on repeated queries');
  console.log('• Multiple models now support 1M+ token contexts');
  console.log('\nTotal models documented: ' + Object.keys(data.models).length);
}

// Run summary
summarizeUpdates().catch(console.error);