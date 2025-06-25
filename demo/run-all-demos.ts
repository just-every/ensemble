#!/usr/bin/env node
/**
 * Run All Demos - Execute all ensemble method demos
 *
 * This script runs through all the demo files to showcase
 * the complete functionality of the Ensemble library.
 */

import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from root directory
dotenv.config({ path: join(__dirname, '..', '.env') });

interface Demo {
    name: string;
    file: string;
    description: string;
    requiredKeys: string[];
}

const demos: Demo[] = [
    {
        name: 'ensembleRequest',
        file: 'ensemble-request-demo.ts',
        description: 'Core streaming API with tool calling',
        requiredKeys: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'],
    },
    {
        name: 'ensembleListen',
        file: 'ensemble-listen-demo.ts',
        description: 'Speech-to-text transcription',
        requiredKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    },
    {
        name: 'ensembleVoice',
        file: 'ensemble-voice-demo.ts',
        description: 'Text-to-speech generation',
        requiredKeys: ['GOOGLE_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY'],
    },
    {
        name: 'ensembleImage',
        file: 'ensemble-image-demo.ts',
        description: 'Image generation',
        requiredKeys: ['OPENAI_API_KEY'],
    },
    {
        name: 'ensembleEmbed',
        file: 'ensemble-embed-demo.ts',
        description: 'Text embeddings for semantic search',
        requiredKeys: ['OPENAI_API_KEY', 'GOOGLE_API_KEY'],
    },
];

function checkApiKeys(): { available: string[]; missing: string[] } {
    const allKeys = [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'GOOGLE_API_KEY',
        'GEMINI_API_KEY',
        'DEEPSEEK_API_KEY',
        'XAI_API_KEY',
        'OPENROUTER_API_KEY',
        'ELEVENLABS_API_KEY',
    ];

    const available = allKeys.filter(key => process.env[key]);
    const missing = allKeys.filter(key => !process.env[key]);

    return { available, missing };
}

function canRunDemo(demo: Demo, availableKeys: string[]): boolean {
    return demo.requiredKeys.some(key => availableKeys.includes(key));
}

async function runDemo(demo: Demo): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🚀 Running ${demo.name} Demo`);
        console.log(`📄 ${demo.description}`);
        console.log(`${'='.repeat(60)}\n`);

        const demoPath = join(__dirname, demo.file);
        const child = spawn('npx', ['tsx', demoPath], {
            stdio: 'inherit',
            env: process.env,
        });

        child.on('error', reject);
        child.on('exit', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Demo exited with code ${code}`));
            }
        });
    });
}

async function main() {
    console.log('🎯 Ensemble Demo Runner\n');
    console.log('This will run all available demos based on your API keys\n');

    // Check available API keys
    const { available, missing } = checkApiKeys();

    console.log('🔑 API Key Status:');
    if (available.length > 0) {
        console.log('\n✅ Available:');
        available.forEach(key => console.log(`   - ${key}`));
    }

    if (missing.length > 0) {
        console.log('\n❌ Missing:');
        missing.forEach(key => console.log(`   - ${key}`));
    }

    // Determine which demos can run
    const runnableDemos = demos.filter(demo => canRunDemo(demo, available));
    const skippedDemos = demos.filter(demo => !canRunDemo(demo, available));

    console.log(`\n📋 Demos to run: ${runnableDemos.length}/${demos.length}`);

    if (runnableDemos.length === 0) {
        console.error('\n❌ No demos can run without API keys!');
        console.error('   Please set at least one API key in your .env file');
        process.exit(1);
    }

    if (skippedDemos.length > 0) {
        console.log('\n⚠️  Skipping demos (missing required keys):');
        skippedDemos.forEach(demo => {
            console.log(`   - ${demo.name}: needs ${demo.requiredKeys.join(' or ')}`);
        });
    }

    // Ask for confirmation
    console.log('\n💡 Press Enter to start or Ctrl+C to cancel...');
    await new Promise(resolve => {
        process.stdin.once('data', resolve);
    });

    // Run demos sequentially
    for (const demo of runnableDemos) {
        try {
            await runDemo(demo);
            console.log(`\n✅ ${demo.name} demo completed`);
        } catch (error) {
            console.error(`\n❌ ${demo.name} demo failed:`, error);
            // Continue with other demos
        }

        // Brief pause between demos
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n\n🎉 All demos completed!');
    console.log('\n📚 Next steps:');
    console.log('   1. Check the demo/output/ directory for generated files');
    console.log('   2. Try the live demos: npm run demo:live');
    console.log('   3. Read the source code to understand the APIs');
    console.log('   4. Build your own applications with Ensemble!');
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n\n👋 Demo runner interrupted');
    process.exit(0);
});

main().catch(error => {
    console.error('\n💥 Demo runner error:', error);
    process.exit(1);
});
