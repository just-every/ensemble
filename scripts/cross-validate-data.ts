#!/usr/bin/env npx tsx
/**
 * Cross-validate model data using multiple sources
 * Uses different LLMs to verify the accuracy of the data
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

interface ValidationCheck {
  field: string;
  expected: any;
  issue?: string;
  severity: 'error' | 'warning' | 'info';
}

async function validateModelDataField(
  modelId: string, 
  fieldName: string, 
  fieldValue: any,
  modelData: any
): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  
  const prompt = `You are a model data validator. Please verify this information about the AI model "${modelId}":

Field: ${fieldName}
Value: ${JSON.stringify(fieldValue, null, 2)}
Full Model Data: ${JSON.stringify(modelData, null, 2)}

Perform these validation checks:

1. For pricing (cost):
   - Is the input/output cost reasonable for this model tier?
   - Compare to similar models from the same provider
   - Flag if pricing seems too high or too low

2. For context length:
   - Is this a valid context window size?
   - Does it match known specifications?
   - Is it technically feasible?

3. For benchmark scores:
   - Are scores in valid ranges (0-100)?
   - Do they align with model capabilities?
   - Are they consistent with each other?

4. For features:
   - Do the capabilities match the model type?
   - Are vision/function calling claims accurate?

5. For aliases:
   - Are these commonly used alternative names?
   - Do they follow naming conventions?

Return a JSON array of issues found:
[
  {
    "field": "fieldname",
    "issue": "description of issue",
    "severity": "error|warning|info"
  }
]

If everything looks correct, return an empty array: []`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
    const issues = JSON.parse(text);
    
    return issues.map((issue: any) => ({
      field: issue.field || fieldName,
      expected: fieldValue,
      issue: issue.issue,
      severity: issue.severity || 'warning'
    }));
  } catch (error) {
    return [{
      field: fieldName,
      expected: fieldValue,
      issue: `Validation error: ${error}`,
      severity: 'error'
    }];
  }
}

async function crossValidateModel(modelId: string, modelData: any): Promise<ValidationCheck[]> {
  const allChecks: ValidationCheck[] = [];
  
  // Validate each important field
  const fieldsToValidate = ['cost', 'features', 'scores', 'aliases', 'description'];
  
  for (const field of fieldsToValidate) {
    if (modelData[field]) {
      const checks = await validateModelDataField(
        modelId,
        field,
        modelData[field],
        modelData
      );
      allChecks.push(...checks);
    }
  }
  
  // Additional cross-field validations
  if (modelData.embedding && modelData.features.supportsFunctions) {
    allChecks.push({
      field: 'features.supportsFunctions',
      expected: false,
      issue: 'Embedding models should not support function calling',
      severity: 'error'
    });
  }
  
  if (modelData.cost.input === 0 && !modelData.description?.includes('free')) {
    allChecks.push({
      field: 'cost',
      expected: modelData.cost,
      issue: 'Zero cost should be mentioned in description',
      severity: 'warning'
    });
  }
  
  return allChecks;
}

async function performCrossValidation() {
  console.log('Starting cross-validation of model data...\n');
  
  // Load the model data
  const dataPath = path.join(__dirname, '..', 'complete-model-data-may-2025.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
  
  const validationResults: Record<string, ValidationCheck[]> = {};
  let totalIssues = 0;
  let errorCount = 0;
  let warningCount = 0;
  
  // Validate each model
  for (const [modelId, modelData] of Object.entries(data.models)) {
    console.log(`Validating ${modelId}...`);
    const checks = await crossValidateModel(modelId, modelData);
    
    if (checks.length > 0) {
      validationResults[modelId] = checks;
      totalIssues += checks.length;
      errorCount += checks.filter(c => c.severity === 'error').length;
      warningCount += checks.filter(c => c.severity === 'warning').length;
      
      console.log(`  Found ${checks.length} issues`);
    } else {
      console.log(`  ✓ Passed all checks`);
    }
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  // Generate report
  console.log('\n=== Cross-Validation Summary ===');
  console.log(`Total models validated: ${Object.keys(data.models).length}`);
  console.log(`Models with issues: ${Object.keys(validationResults).length}`);
  console.log(`Total issues found: ${totalIssues}`);
  console.log(`  - Errors: ${errorCount}`);
  console.log(`  - Warnings: ${warningCount}`);
  console.log(`  - Info: ${totalIssues - errorCount - warningCount}`);
  
  if (Object.keys(validationResults).length > 0) {
    console.log('\n=== Issues by Model ===');
    for (const [modelId, checks] of Object.entries(validationResults)) {
      console.log(`\n${modelId}:`);
      for (const check of checks) {
        const icon = check.severity === 'error' ? '❌' : 
                     check.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`  ${icon} [${check.field}] ${check.issue}`);
      }
    }
  }
  
  // Save detailed report
  const reportPath = path.join(__dirname, '..', 'cross-validation-report.json');
  await fs.writeFile(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      totalModels: Object.keys(data.models).length,
      modelsWithIssues: Object.keys(validationResults).length,
      totalIssues,
      errors: errorCount,
      warnings: warningCount,
      info: totalIssues - errorCount - warningCount
    },
    validationResults
  }, null, 2));
  
  console.log(`\n✓ Detailed report saved to: cross-validation-report.json`);
  
  // Suggest fixes
  if (errorCount > 0) {
    console.log('\n⚠️  Critical issues found that should be fixed before merging');
  }
}

// Run cross-validation
performCrossValidation().catch(console.error);