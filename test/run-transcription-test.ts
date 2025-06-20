/**
 * Test runner that properly loads environment variables
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Now import and run the test
import('./transcription-integration.js')
    .then(() => {
        console.log('Test module loaded');
    })
    .catch(error => {
        console.error('Failed to load test:', error);
    });
