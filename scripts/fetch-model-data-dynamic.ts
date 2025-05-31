#!/usr/bin/env npx tsx
/**
 * Fetch model data from provider APIs where available
 * This script queries actual provider APIs instead of using unreliable web search
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

interface ModelInfo {
  id: string;
  provider: string;
  description?: string;
  contextLength?: number;
  deprecated?: boolean;
}

// Fetch OpenAI models
async function fetchOpenAIModels(): Promise<ModelInfo[]> {
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  No OpenAI API key, skipping OpenAI models');
    return [];
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const models = await openai.models.list();
    
    return models.data
      .filter(model => 
        model.id.includes('gpt') || 
        model.id.includes('dall-e') || 
        model.id.includes('text-embedding')
      )
      .map(model => ({
        id: model.id,
        provider: 'openai',
        description: `OpenAI model ${model.id}`
      }));
  } catch (error) {
    console.error('❌ Error fetching OpenAI models:', error);
    return [];
  }
}

// Known models that can't be fetched via API
const KNOWN_MODELS: ModelInfo[] = [
  // Anthropic (no public model listing API)
  {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    description: 'Most capable Claude model, excels at complex tasks',
    contextLength: 200000
  },
  {
    id: 'claude-3-5-haiku-20241022', 
    provider: 'anthropic',
    description: 'Fast and efficient Claude model',
    contextLength: 200000
  },
  {
    id: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    description: 'Previous generation fast Claude model',
    contextLength: 200000
  },
  {
    id: 'claude-3-opus-20240229',
    provider: 'anthropic',
    description: 'Previous generation powerful Claude model',
    contextLength: 200000,
    deprecated: true
  },
  {
    id: 'claude-3-sonnet-20240229',
    provider: 'anthropic',
    description: 'Previous generation balanced Claude model',
    contextLength: 200000,
    deprecated: true
  },

  // Google Gemini (would need Google AI API)
  {
    id: 'gemini-2.0-flash-exp',
    provider: 'google',
    description: 'Experimental Gemini 2.0 Flash model',
    contextLength: 1048576
  },
  {
    id: 'gemini-1.5-pro-002',
    provider: 'google',
    description: 'Gemini 1.5 Pro with improvements',
    contextLength: 2097152
  },
  {
    id: 'gemini-1.5-flash-002',
    provider: 'google',
    description: 'Fast Gemini 1.5 model',
    contextLength: 1048576
  },
  {
    id: 'gemini-1.5-flash-8b-latest',
    provider: 'google',
    description: 'Lightweight 8B parameter Gemini model',
    contextLength: 1048576
  },

  // DeepSeek
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    description: 'DeepSeek chat model',
    contextLength: 64000
  },
  {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    description: 'DeepSeek reasoning model with advanced capabilities',
    contextLength: 64000
  },

  // xAI
  {
    id: 'grok-2-1212',
    provider: 'xai',
    description: 'Grok 2 model',
    contextLength: 131072
  },
  {
    id: 'grok-2-vision-1212',
    provider: 'xai',
    description: 'Grok 2 with vision capabilities',
    contextLength: 131072
  }
];

// Pricing data (would need to be manually updated or fetched from pricing pages)
const PRICING_DATA: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 1.00, output: 5.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },

  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },

  // Google (per million tokens)
  'gemini-2.0-flash-exp': { input: 0.00, output: 0.00 }, // Free during experimental
  'gemini-1.5-pro-002': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash-002': { input: 0.075, output: 0.30 },
  'gemini-1.5-flash-8b-latest': { input: 0.0375, output: 0.15 },

  // DeepSeek
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },

  // xAI
  'grok-2-1212': { input: 2.00, output: 10.00 },
  'grok-2-vision-1212': { input: 2.00, output: 10.00 }
};

// Generate TypeScript code
function generateTypeScriptCode(models: ModelInfo[]): string {
  const timestamp = new Date().toISOString();
  
  let code = `/**
 * Model data fetched on ${timestamp}
 * Generated from provider APIs and known model information
 */

import { ModelEntry } from './types.js';

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
`;

  // Group by provider
  const byProvider = models.reduce((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, ModelInfo[]>);

  for (const [provider, providerModels] of Object.entries(byProvider)) {
    code += `\n  // ${provider.toUpperCase()} Models\n`;
    
    for (const model of providerModels) {
      const pricing = PRICING_DATA[model.id] || { input: 0, output: 0 };
      
      code += `  '${model.id}': {\n`;
      code += `    id: '${model.id}',\n`;
      code += `    provider: '${provider}' as const,\n`;
      code += `    cost: {\n`;
      code += `      input: ${pricing.input},\n`;
      code += `      output: ${pricing.output}\n`;
      code += `    },\n`;
      code += `    features: {\n`;
      code += `      contextLength: ${model.contextLength || 4096},\n`;
      code += `      supportsFunctions: true,\n`;
      code += `      supportsVision: ${model.id.includes('vision') || model.id.includes('gpt-4o')},\n`;
      code += `      supportsStreaming: true,\n`;
      code += `      supportsSystemMessages: true\n`;
      code += `    }`;
      
      if (model.description) {
        code += `,\n    description: '${model.description}'`;
      }
      
      if (model.deprecated) {
        code += `,\n    deprecated: true`;
      }
      
      code += `\n  },\n`;
    }
  }
  
  code += `};\n\n`;
  code += `// Total models: ${models.length}\n`;
  code += `// Generated on: ${timestamp}\n`;
  
  return code;
}

// Main function
async function fetchModelData() {
  console.log('🚀 Model Data Fetcher');
  console.log('====================\n');
  
  // Fetch from APIs
  console.log('📡 Fetching from provider APIs...');
  const openaiModels = await fetchOpenAIModels();
  console.log(`  ✓ OpenAI: ${openaiModels.length} models`);
  
  // Combine with known models
  const allModels = [...KNOWN_MODELS, ...openaiModels];
  
  // Remove duplicates
  const uniqueModels = Array.from(
    new Map(allModels.map(m => [m.id, m])).values()
  );
  
  console.log(`\n📊 Total unique models: ${uniqueModels.length}`);
  
  // Save raw data
  const dataPath = path.join(__dirname, '..', 'model-search-results-dynamic.json');
  await fs.writeFile(dataPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalModels: uniqueModels.length,
    models: uniqueModels
  }, null, 2));
  
  // Generate TypeScript
  const tsCode = generateTypeScriptCode(uniqueModels);
  const tsPath = path.join(__dirname, '..', 'model-data-dynamic.ts');
  await fs.writeFile(tsPath, tsCode);
  
  console.log('\n✅ Files generated:');
  console.log('  - model-search-results-dynamic.json');
  console.log('  - model-data-dynamic.ts');
  console.log('\n✨ Done! Run validation and tests next.');
}

// Run
fetchModelData().catch(console.error);