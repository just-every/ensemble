#!/usr/bin/env node

/**
 * Script to capture screenshots of all demos
 * Requires puppeteer: npm install puppeteer
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const demos = [
    {
        name: 'demo-interface',
        url: 'http://localhost:3000',
        waitFor: 2000
    },
    {
        name: 'chat-demo',
        url: 'http://localhost:3005/request-client.html',
        waitFor: 2000
    },
    {
        name: 'embed-demo',
        url: 'http://localhost:3006/embed-client.html',
        waitFor: 2000
    },
    {
        name: 'voice-demo',
        url: 'http://localhost:3004/voice-client.html',
        waitFor: 2000
    },
    {
        name: 'transcription-demo',
        url: 'http://localhost:3003/transcription-client.html',
        waitFor: 2000
    }
];

async function captureScreenshots() {
    console.log('🚀 Starting screenshot capture...');
    console.log('Make sure all demo servers are running with: npm run demo\n');
    
    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: {
            width: 1280,
            height: 800
        }
    });

    for (const demo of demos) {
        try {
            console.log(`📸 Capturing ${demo.name}...`);
            const page = await browser.newPage();
            await page.goto(demo.url, { waitUntil: 'networkidle2' });
            await page.waitForTimeout(demo.waitFor);
            
            const screenshotPath = join(__dirname, 'screenshots', `${demo.name}.png`);
            await page.screenshot({ 
                path: screenshotPath,
                fullPage: false
            });
            
            console.log(`   ✅ Saved to screenshots/${demo.name}.png`);
            await page.close();
        } catch (error) {
            console.error(`   ❌ Failed to capture ${demo.name}: ${error.message}`);
        }
    }

    await browser.close();
    console.log('\n✨ Screenshot capture complete!');
}

captureScreenshots().catch(console.error);