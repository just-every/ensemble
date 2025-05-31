#!/usr/bin/env npx tsx
/**
 * Test new models using ensemble's request function
 * This helps verify models work before adding them to the registry
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { request } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

interface TestResult {
  model: string;
  provider: string;
  success: boolean;
  error?: string;
  responseTime?: number;
  response?: string;
}

// Test prompts
const TEST_PROMPT = 'Reply with exactly: "Model test successful". Nothing else.';

// Test model using ensemble
async function testModel(modelId: string, expectedProvider: string): Promise<TestResult> {
  const start = Date.now();
  
  try {
    let fullResponse = '';
    
    // Stream the response
    for await (const event of request(modelId, [
      { type: 'message', role: 'user', content: TEST_PROMPT }
    ], {
      temperature: 0,
      max_tokens: 50
    })) {
      if (event.type === 'text_delta') {
        fullResponse += event.delta;
      }
    }
    
    return {
      model: modelId,
      provider: expectedProvider,
      success: fullResponse.includes('Model test successful'),
      response: fullResponse,
      responseTime: Date.now() - start
    };
  } catch (error: any) {
    return {
      model: modelId,
      provider: expectedProvider,
      success: false,
      error: error.message || String(error),
      responseTime: Date.now() - start
    };
  }
}

// Models to test (from model-data-dynamic.ts if it exists)
async function getModelsToTest(): Promise<Array<{ id: string; provider: string }>> {
  // First try to load from generated dynamic data
  const dynamicDataPath = path.join(__dirname, '..', 'model-data-dynamic.ts');
  
  try {
    await fs.access(dynamicDataPath);
    // Import the dynamic data
    const { MODEL_REGISTRY } = await import(dynamicDataPath);
    
    // Extract models from registry
    return Object.values(MODEL_REGISTRY).map((model: any) => ({
      id: model.id,
      provider: model.provider
    }));
  } catch {
    // Fallback to hardcoded list of models to test
    console.log('No model-data-dynamic.ts found, using default model list');
    
    return [
      // Anthropic
      { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022', provider: 'anthropic' },
      { id: 'claude-3-haiku-20240307', provider: 'anthropic' },
      
      // OpenAI
      { id: 'gpt-4o', provider: 'openai' },
      { id: 'gpt-4o-mini', provider: 'openai' },
      { id: 'gpt-3.5-turbo', provider: 'openai' },
      
      // Google
      { id: 'gemini-2.0-flash-exp', provider: 'google' },
      { id: 'gemini-1.5-pro-002', provider: 'google' },
      { id: 'gemini-1.5-flash-002', provider: 'google' },
      
      // DeepSeek
      { id: 'deepseek-chat', provider: 'deepseek' },
      { id: 'deepseek-reasoner', provider: 'deepseek' },
      
      // xAI
      { id: 'grok-2-1212', provider: 'xai' },
      { id: 'grok-2-vision-1212', provider: 'xai' }
    ];
  }
}

async function testAllModels() {
  console.log('🧪 Testing models using ensemble...\n');
  
  const modelsToTest = await getModelsToTest();
  const results: TestResult[] = [];
  
  // Check which API keys are available
  const availableProviders = new Set<string>();
  if (process.env.ANTHROPIC_API_KEY) availableProviders.add('anthropic');
  if (process.env.OPENAI_API_KEY) availableProviders.add('openai');
  if (process.env.GOOGLE_API_KEY) availableProviders.add('google');
  if (process.env.DEEPSEEK_API_KEY) availableProviders.add('deepseek');
  if (process.env.XAI_API_KEY) availableProviders.add('xai');
  
  console.log('Available providers:', Array.from(availableProviders).join(', '));
  console.log(`Testing ${modelsToTest.length} models...\n`);
  
  for (const { id, provider } of modelsToTest) {
    // Skip if no API key for provider
    if (!availableProviders.has(provider)) {
      results.push({
        model: id,
        provider,
        success: false,
        error: `No ${provider.toUpperCase()} API key`
      });
      continue;
    }
    
    console.log(`Testing ${id}...`);
    const result = await testModel(id, provider);
    results.push(result);
    
    if (result.success) {
      console.log(`  ✅ Success (${result.responseTime}ms)`);
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
    }
    
    // Small delay between tests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('===============');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`Total models tested: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  
  // Group by provider
  const byProvider = results.reduce((acc, r) => {
    if (!acc[r.provider]) acc[r.provider] = { success: 0, failed: 0 };
    if (r.success) acc[r.provider].success++;
    else acc[r.provider].failed++;
    return acc;
  }, {} as Record<string, { success: number; failed: number }>);
  
  console.log('\nBy Provider:');
  for (const [provider, stats] of Object.entries(byProvider)) {
    console.log(`  ${provider}: ${stats.success} success, ${stats.failed} failed`);
  }
  
  if (successful.length > 0) {
    console.log('\n✅ Working models:');
    for (const result of successful) {
      console.log(`  - ${result.model} (${result.responseTime}ms)`);
    }
  }
  
  if (failed.length > 0) {
    console.log('\n❌ Failed models:');
    const failedByError = failed.reduce((acc, r) => {
      const key = r.error || 'Unknown error';
      if (!acc[key]) acc[key] = [];
      acc[key].push(r.model);
      return acc;
    }, {} as Record<string, string[]>);
    
    for (const [error, models] of Object.entries(failedByError)) {
      console.log(`  ${error}:`);
      for (const model of models) {
        console.log(`    - ${model}`);
      }
    }
  }
  
  // Save report
  const reportPath = path.join(__dirname, '..', 'model-test-report.json');
  await fs.writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      byProvider
    },
    results
  }, null, 2));
  
  console.log(`\n📄 Test report saved to: model-test-report.json`);
  
  // Return exit code based on results
  process.exit(failed.length > 0 ? 1 : 0);
}

// Run tests
testAllModels().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});