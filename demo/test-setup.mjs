#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Quick test script to verify the demo setup
console.log('🔍 Checking demo setup...\n');

// Check Node version
const nodeVersion = process.version;
console.log(`✓ Node.js version: ${nodeVersion}`);

// Check if API key is set
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (apiKey) {
    console.log(`✓ API Key found: ${apiKey.substring(0, 8)}...`);
} else {
    console.log('❌ API Key missing! Set GOOGLE_API_KEY or GEMINI_API_KEY');
}

// Check if dist directory exists
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
    console.log('✓ Build directory exists');
    
    // Check for key files
    const indexPath = path.join(distPath, 'index.js');
    const livePath = path.join(distPath, 'core', 'ensemble_live.js');
    
    if (fs.existsSync(indexPath)) {
        console.log('✓ Main index.js found');
    } else {
        console.log('❌ Main index.js missing');
    }
    
    if (fs.existsSync(livePath)) {
        console.log('✓ ensemble_live.js found');
    } else {
        console.log('❌ ensemble_live.js missing');
    }
} else {
    console.log('❌ Build directory missing! Run: npm run build');
}

// Check for required dependencies by checking package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const requiredDeps = ['express', 'ws'];
const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

requiredDeps.forEach(dep => {
    if (deps[dep]) {
        console.log(`✓ ${dep} listed in dependencies`);
    } else {
        console.log(`❌ ${dep} not found in dependencies`);
    }
});

console.log('\n📋 Available demos:');
console.log('  1. Live Demo: npm run demo:live');
console.log('     - Real-time bidirectional voice conversation');
console.log('     - Tool execution (weather, calculator)');
console.log('     - http://localhost:3004\n');

console.log('  2. Transcription Demo: npm run demo:transcription');
console.log('     - Speech-to-text transcription');
console.log('     - Live streaming with cost tracking');
console.log('     - http://localhost:3003\n');

console.log('💡 To run the demos:');
console.log('   1. Set your API key:');
console.log('      export GOOGLE_API_KEY=your-key-here\n');
console.log('   2. Build the project (if not already built):');
console.log('      npm run build\n');
console.log('   3. Run a demo:');
console.log('      npm run demo:live');
console.log('      # or');
console.log('      npm run demo:transcription\n');