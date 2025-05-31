#!/usr/bin/env npx tsx
/**
 * Test new models directly without needing them in the registry
 * This helps verify models work before adding them
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/genai';

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

// Initialize clients
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
}) : null;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

const genAI = process.env.GOOGLE_API_KEY ? new GoogleGenerativeAI(
  process.env.GOOGLE_API_KEY
) : null;

// Test Anthropic model
async function testAnthropicModel(modelId: string): Promise<TestResult> {
  if (!anthropic) {
    return { model: modelId, provider: 'anthropic', success: false, error: 'No API key' };
  }
  
  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 50,
      temperature: 0,
      messages: [{ role: 'user', content: TEST_PROMPT }]
    });
    
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return {
      model: modelId,
      provider: 'anthropic',
      success: text.includes('Model test successful'),
      response: text,
      responseTime: Date.now() - start
    };
  } catch (error: any) {
    return {
      model: modelId,
      provider: 'anthropic',
      success: false,
      error: error.message || String(error),
      responseTime: Date.now() - start
    };
  }
}

// Test OpenAI model
async function testOpenAIModel(modelId: string): Promise<TestResult> {
  if (!openai) {
    return { model: modelId, provider: 'openai', success: false, error: 'No API key' };
  }
  
  const start = Date.now();
  try {
    const response = await openai.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      temperature: 0,
      max_tokens: 50
    });
    
    const text = response.choices[0]?.message?.content || '';
    return {
      model: modelId,
      provider: 'openai',
      success: text.includes('Model test successful'),
      response: text,
      responseTime: Date.now() - start
    };
  } catch (error: any) {
    return {
      model: modelId,
      provider: 'openai',
      success: false,
      error: error.message || String(error),
      responseTime: Date.now() - start
    };
  }
}

// Test Google model
async function testGoogleModel(modelId: string): Promise<TestResult> {
  if (!genAI) {
    return { model: modelId, provider: 'google', success: false, error: 'No API key' };
  }
  
  const start = Date.now();
  try {
    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await model.generateContent(TEST_PROMPT);
    const text = result.response.text();
    
    return {
      model: modelId,
      provider: 'google',
      success: text.includes('Model test successful'),
      response: text,
      responseTime: Date.now() - start
    };
  } catch (error: any) {
    return {
      model: modelId,
      provider: 'google',
      success: false,
      error: error.message || String(error),
      responseTime: Date.now() - start
    };
  }
}

// Test DeepSeek model (uses OpenAI-compatible API)
async function testDeepSeekModel(modelId: string): Promise<TestResult> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { model: modelId, provider: 'deepseek', success: false, error: 'No API key' };
  }
  
  const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com'
  });
  
  const start = Date.now();
  try {
    const response = await deepseek.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      temperature: 0,
      max_tokens: 50
    });
    
    const text = response.choices[0]?.message?.content || '';
    return {
      model: modelId,
      provider: 'deepseek',
      success: text.includes('Model test successful'),
      response: text,
      responseTime: Date.now() - start
    };
  } catch (error: any) {
    return {
      model: modelId,
      provider: 'deepseek',
      success: false,
      error: error.message || String(error),
      responseTime: Date.now() - start
    };
  }
}

// Test xAI model
async function testXAIModel(modelId: string): Promise<TestResult> {
  if (!process.env.XAI_API_KEY) {
    return { model: modelId, provider: 'xai', success: false, error: 'No API key' };
  }
  
  const xai = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1'
  });
  
  const start = Date.now();
  try {
    const response = await xai.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      temperature: 0,
      max_tokens: 50
    });
    
    const text = response.choices[0]?.message?.content || '';
    return {
      model: modelId,
      provider: 'xai',
      success: text.includes('Model test successful'),
      response: text,
      responseTime: Date.now() - start
    };
  } catch (error: any) {
    return {
      model: modelId,
      provider: 'xai',
      success: false,
      error: error.message || String(error),
      responseTime: Date.now() - start
    };
  }
}

// Models to test (May 2025)
const MODELS_TO_TEST = [
  // Anthropic
  { id: 'claude-opus-4-20250522', provider: 'anthropic' },
  { id: 'claude-sonnet-4-20250522', provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022', provider: 'anthropic' },
  
  // OpenAI
  { id: 'o3', provider: 'openai' },
  { id: 'o3-mini', provider: 'openai' },
  { id: 'gpt-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', provider: 'openai' },
  
  // Google
  { id: 'gemini-2.5-pro', provider: 'google' },
  { id: 'gemini-2.5-flash', provider: 'google' },
  { id: 'gemini-2.0-flash', provider: 'google' },
  { id: 'gemini-2.0-flash-lite', provider: 'google' },
  
  // DeepSeek
  { id: 'deepseek-chat', provider: 'deepseek' },
  { id: 'deepseek-reasoner', provider: 'deepseek' },
  
  // xAI
  { id: 'grok-3', provider: 'xai' },
  { id: 'grok-3-mini', provider: 'xai' }
];

async function testAllModels() {
  console.log('Testing new models with direct API calls...\n');
  
  const results: TestResult[] = [];
  
  for (const { id, provider } of MODELS_TO_TEST) {
    console.log(`Testing ${id}...`);
    
    let result: TestResult;
    switch (provider) {
      case 'anthropic':
        result = await testAnthropicModel(id);
        break;
      case 'openai':
        result = await testOpenAIModel(id);
        break;
      case 'google':
        result = await testGoogleModel(id);
        break;
      case 'deepseek':
        result = await testDeepSeekModel(id);
        break;
      case 'xai':
        result = await testXAIModel(id);
        break;
      default:
        result = { model: id, provider, success: false, error: 'Unknown provider' };
    }
    
    results.push(result);
    
    if (result.success) {
      console.log(`  ✓ Success (${result.responseTime}ms)`);
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n=== Test Summary ===');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`Total models tested: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  
  if (successful.length > 0) {
    console.log('\n✓ Working models:');
    for (const result of successful) {
      console.log(`  - ${result.model} (${result.responseTime}ms)`);
    }
  }
  
  if (failed.length > 0) {
    console.log('\n✗ Failed models:');
    for (const result of failed) {
      console.log(`  - ${result.model}: ${result.error}`);
    }
  }
  
  // Save report
  const reportPath = path.join(__dirname, '..', 'model-test-report.json');
  await fs.writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      successful: successful.length,
      failed: failed.length
    },
    results
  }, null, 2));
  
  console.log(`\n✓ Test report saved to: model-test-report.json`);
}

// Run tests
testAllModels().catch(console.error);