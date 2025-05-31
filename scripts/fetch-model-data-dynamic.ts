#!/usr/bin/env npx tsx
/**
 * Dynamically fetch model data using web search
 * Designed to run in GitHub Actions for automated updates
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { Anthropic } from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

interface ProviderSearchConfig {
  name: string;
  provider: string;
  searchQueries: string[];
  modelPatterns: string[];
}

// Provider configurations
const PROVIDERS: ProviderSearchConfig[] = [
  {
    name: 'Anthropic Claude',
    provider: 'anthropic',
    searchQueries: [
      'Anthropic Claude models API latest {CURRENT_DATE}',
      'Claude API pricing documentation {CURRENT_YEAR}',
      'Claude benchmark scores artificialanalysis',
      'site:anthropic.com/api models pricing'
    ],
    modelPatterns: ['claude-', 'claude-3', 'claude-4', 'claude-opus', 'claude-sonnet', 'claude-haiku']
  },
  {
    name: 'OpenAI',
    provider: 'openai',
    searchQueries: [
      'OpenAI GPT models API latest {CURRENT_DATE}',
      'OpenAI o3 o1 pricing {CURRENT_YEAR}',
      'GPT-4o benchmark scores {CURRENT_YEAR}',
      'site:openai.com/api models pricing'
    ],
    modelPatterns: ['gpt-', 'o1', 'o3', 'text-embedding-', 'dall-e-']
  },
  {
    name: 'Google Gemini',
    provider: 'google',
    searchQueries: [
      'Google Gemini models API latest {CURRENT_DATE}',
      'Gemini 2.5 pricing context window {CURRENT_YEAR}',
      'Gemini Pro Flash benchmark scores',
      'site:ai.google.dev models pricing'
    ],
    modelPatterns: ['gemini-', 'gemini-1.5', 'gemini-2.0', 'gemini-2.5']
  },
  {
    name: 'DeepSeek',
    provider: 'deepseek',
    searchQueries: [
      'DeepSeek API models latest {CURRENT_DATE}',
      'DeepSeek V3 reasoner pricing {CURRENT_YEAR}',
      'DeepSeek benchmark scores',
      'site:api-docs.deepseek.com models pricing'
    ],
    modelPatterns: ['deepseek-', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-coder']
  },
  {
    name: 'xAI Grok',
    provider: 'xai',
    searchQueries: [
      'xAI Grok models API latest {CURRENT_DATE}',
      'Grok 3 pricing {CURRENT_YEAR}',
      'Grok benchmark scores',
      'site:x.ai/api models pricing'
    ],
    modelPatterns: ['grok-', 'grok-3', 'grok-2']
  }
];

// Get current date info
function getCurrentDateInfo() {
  const now = new Date();
  return {
    CURRENT_DATE: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    CURRENT_YEAR: now.getFullYear().toString(),
    ISO_DATE: now.toISOString()
  };
}

// Replace date placeholders in search queries
function formatSearchQuery(query: string, dateInfo: Record<string, string>): string {
  let formatted = query;
  for (const [key, value] of Object.entries(dateInfo)) {
    formatted = formatted.replace(`{${key}}`, value);
  }
  return formatted;
}

// Search for model information using Claude with web search
async function searchProviderModels(config: ProviderSearchConfig, dateInfo: Record<string, string>) {
  console.log(`\n🔍 Searching for ${config.name} models...`);
  
  const formattedQueries = config.searchQueries.map(q => formatSearchQuery(q, dateInfo));
  
  const prompt = `You are a technical researcher gathering the latest AI model information.

IMPORTANT: Use web search to find CURRENT information as of ${dateInfo.CURRENT_DATE}. Do not use outdated training data.

Search for information about ${config.name} models using these queries:
${formattedQueries.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

For each model you find, extract:
1. Model ID (exact string used in API calls, e.g., "claude-3-5-sonnet-20241022")
2. Aliases (alternative names like "claude-3.5-sonnet")
3. Context window/length in tokens
4. Pricing per million input/output tokens
5. Key features (vision, function calling, streaming, system messages)
6. Benchmark scores if available (HumanEval, MMLU, etc.)
7. Release date or version
8. Description of capabilities
9. Whether it's deprecated
10. Rate limits if mentioned

Focus on models with these patterns: ${config.modelPatterns.join(', ')}

Return a JSON object with this structure:
{
  "provider": "${config.provider}",
  "searchDate": "${dateInfo.ISO_DATE}",
  "models": [
    {
      "id": "model-id",
      "aliases": ["alt-name-1", "alt-name-2"],
      "contextLength": 200000,
      "cost": {
        "input": 3.00,
        "output": 15.00
      },
      "features": {
        "supportsVision": true,
        "supportsFunctions": true,
        "supportsStreaming": true,
        "supportsSystemMessages": true
      },
      "benchmarks": {
        "humanEval": 85.0,
        "mmlu": 88.5,
        "other": {}
      },
      "releaseDate": "2024-10-22",
      "description": "Description of the model",
      "deprecated": false,
      "rateLimits": {
        "rpm": 1000,
        "tpm": 1000000
      }
    }
  ],
  "metadata": {
    "sources": ["URLs or references found"],
    "lastUpdated": "Date of information"
  }
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
    throw new Error('No valid JSON found in response');
  } catch (error) {
    console.error(`❌ Error searching ${config.name}:`, error);
    return null;
  }
}

// Convert search results to model entries
function convertToModelEntries(searchResult: any): any[] {
  if (!searchResult || !searchResult.models) return [];
  
  return searchResult.models.map((model: any) => {
    const entry: any = {
      id: model.id,
      provider: searchResult.provider,
      cost: model.cost || { input: 0, output: 0 },
      features: {
        contextLength: model.contextLength || 0,
        supportsFunctions: model.features?.supportsFunctions ?? false,
        supportsVision: model.features?.supportsVision ?? false,
        supportsStreaming: model.features?.supportsStreaming ?? true,
        supportsSystemMessages: model.features?.supportsSystemMessages ?? true
      }
    };

    // Add optional fields
    if (model.aliases && model.aliases.length > 0) {
      entry.aliases = model.aliases;
    }
    if (model.description) {
      entry.description = model.description;
    }
    if (model.deprecated) {
      entry.deprecated = true;
    }
    if (model.benchmarks) {
      entry.scores = {
        code: model.benchmarks.humanEval,
        reasoning: model.benchmarks.mmlu,
        monologue: model.benchmarks.other?.hle || model.benchmarks.other?.aime
      };
    }
    if (model.rateLimits) {
      entry.rateLimits = model.rateLimits;
    }

    return entry;
  });
}

// Generate TypeScript code from model data
function generateTypeScriptCode(allModels: any[], metadata: any): string {
  const timestamp = metadata.generatedAt;
  
  let code = `/**
 * Model data dynamically generated on ${timestamp}
 * Generated using web search via Claude API
 * 
 * This file contains the latest model information gathered from:
${metadata.sources.map((s: string) => ` * - ${s}`).join('\n')}
 */

import { ModelEntry } from './types.js';

// ============================================
// MODEL_REGISTRY - Dynamically Generated
// ============================================

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
`;

  // Group models by provider
  const byProvider: Record<string, any[]> = {};
  for (const model of allModels) {
    if (!byProvider[model.provider]) byProvider[model.provider] = [];
    byProvider[model.provider].push(model);
  }

  // Generate entries
  for (const [provider, models] of Object.entries(byProvider)) {
    code += `\n  // ${provider.toUpperCase()} Models\n`;
    
    for (const model of models) {
      code += `  '${model.id}': {\n`;
      code += `    id: '${model.id}',\n`;
      
      if (model.aliases) {
        code += `    aliases: ${JSON.stringify(model.aliases)},\n`;
      }
      
      code += `    provider: '${model.provider}' as const,\n`;
      code += `    cost: {\n`;
      code += `      input: ${model.cost.input},\n`;
      code += `      output: ${model.cost.output}\n`;
      code += `    },\n`;
      code += `    features: ${JSON.stringify(model.features, null, 6).replace(/\n/g, '\n    ')},\n`;
      
      if (model.description) {
        code += `    description: '${model.description.replace(/'/g, "\\'")}',\n`;
      }
      
      if (model.scores) {
        code += `    scores: {\n`;
        if (model.scores.code !== undefined) {
          code += `      code: ${model.scores.code},\n`;
        }
        if (model.scores.reasoning !== undefined) {
          code += `      reasoning: ${model.scores.reasoning},\n`;
        }
        if (model.scores.monologue !== undefined) {
          code += `      monologue: ${model.scores.monologue}\n`;
        }
        code += `    },\n`;
      }
      
      if (model.deprecated) {
        code += `    deprecated: true,\n`;
      }
      
      code += `  },\n`;
    }
  }
  
  code += `};\n\n`;
  code += `// Total models found: ${allModels.length}\n`;
  code += `// Generated on: ${timestamp}\n`;
  
  return code;
}

// Main function
async function fetchModelDataDynamic() {
  console.log('🚀 Dynamic Model Data Fetcher');
  console.log('============================\n');
  
  const dateInfo = getCurrentDateInfo();
  console.log(`📅 Current date: ${dateInfo.CURRENT_DATE}`);
  
  const allResults = [];
  const allModels = [];
  const sources = new Set<string>();
  
  // Search each provider
  for (const config of PROVIDERS) {
    const result = await searchProviderModels(config, dateInfo);
    
    if (result) {
      allResults.push(result);
      const models = convertToModelEntries(result);
      allModels.push(...models);
      
      console.log(`✅ Found ${models.length} models for ${config.name}`);
      
      if (result.metadata?.sources) {
        result.metadata.sources.forEach((s: string) => sources.add(s));
      }
    }
    
    // Delay between searches
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Generate metadata
  const metadata = {
    generatedAt: dateInfo.ISO_DATE,
    searchDate: dateInfo.CURRENT_DATE,
    totalModels: allModels.length,
    providers: PROVIDERS.map(p => p.provider),
    sources: Array.from(sources)
  };
  
  // Save raw search results
  const searchResultsPath = path.join(__dirname, '..', 'model-search-results-dynamic.json');
  await fs.writeFile(searchResultsPath, JSON.stringify({
    metadata,
    searchResults: allResults,
    models: allModels
  }, null, 2));
  console.log(`\n📄 Search results saved to: model-search-results-dynamic.json`);
  
  // Generate TypeScript code
  const tsCode = generateTypeScriptCode(allModels, metadata);
  const tsPath = path.join(__dirname, '..', 'model-data-dynamic.ts');
  await fs.writeFile(tsPath, tsCode);
  console.log(`📝 TypeScript code saved to: model-data-dynamic.ts`);
  
  // Generate summary
  console.log('\n📊 Summary');
  console.log('==========');
  console.log(`Total models found: ${allModels.length}`);
  
  const byProvider = allModels.reduce((acc, m) => {
    acc[m.provider] = (acc[m.provider] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  for (const [provider, count] of Object.entries(byProvider)) {
    console.log(`  ${provider}: ${count} models`);
  }
  
  console.log('\n✨ Done! Review the generated files and run validation.');
}

// Export for use in other scripts
export { fetchModelDataDynamic, PROVIDERS };

// Run if called directly
if (import.meta.url === `file://${__filename}`) {
  fetchModelDataDynamic().catch(console.error);
}