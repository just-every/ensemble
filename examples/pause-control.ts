/**
 * Example: Pause Control
 *
 * This example demonstrates how to pause and resume LLM requests
 * across the entire ensemble system.
 */

import {
    ensembleRequest,
    pause,
    resume,
    isPaused,
    getPauseController,
} from '../index.js';

async function main() {
    console.log('=== Pause Control Example ===\n');

    // Listen for pause/resume events
    const controller = getPauseController();
    controller.on('paused', () => {
        console.log('⏸️  System PAUSED - All LLM requests will wait');
    });
    controller.on('resumed', () => {
        console.log('▶️  System RESUMED - LLM requests continuing');
    });

    // Example 1: Pause during a request
    console.log('Example 1: Pausing during a streaming request\n');

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content:
                'Count from 1 to 10 slowly, with a brief description for each number.',
        },
    ];

    // Start a request in the background
    const requestPromise = (async () => {
        let fullContent = '';
        console.log('Starting LLM request...\n');

        for await (const event of ensembleRequest(messages)) {
            if (event.type === 'message_delta' && event.content) {
                process.stdout.write(event.content);
                fullContent += event.content;
            }
        }

        console.log('\n\nRequest completed!');
        return fullContent;
    })();

    // Pause after 2 seconds
    setTimeout(() => {
        console.log('\n\n--- Pausing system after 2 seconds ---');
        pause();

        // Resume after another 3 seconds
        setTimeout(() => {
            console.log('\n--- Resuming after 3 second pause ---\n');
            resume();
        }, 3000);
    }, 2000);

    // Wait for the request to complete
    await requestPromise;

    // Example 2: Pre-pausing before requests
    console.log('\n\nExample 2: Pre-pausing the system\n');

    pause();
    console.log(`System paused status: ${isPaused()}`);

    // Start multiple requests while paused
    const request1 = ensembleRequest([
        { type: 'message', role: 'user', content: 'Say "Request 1 completed"' },
    ]);

    const request2 = ensembleRequest([
        { type: 'message', role: 'user', content: 'Say "Request 2 completed"' },
    ]);

    console.log('Started 2 requests while paused - they are waiting...');

    // Wait a bit to show they're really paused
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\nResuming system - requests will now proceed...\n');
    resume();

    // Collect results
    for await (const event of request1) {
        if (event.type === 'message_complete') {
            console.log('Request 1:', event.content);
        }
    }

    for await (const event of request2) {
        if (event.type === 'message_complete') {
            console.log('Request 2:', event.content);
        }
    }

    // Example 3: Pause with abort
    console.log('\n\nExample 3: Aborting during pause\n');

    const abortController = new AbortController();

    pause();
    console.log('System paused, starting request with abort signal...');

    const abortableRequest = (async () => {
        try {
            for await (const event of ensembleRequest(
                [
                    {
                        type: 'message',
                        role: 'user',
                        content: 'This will be aborted',
                    },
                ],
                { abortSignal: abortController.signal }
            )) {
                if (event.type === 'message_delta') {
                    process.stdout.write(event.content || '');
                }
            }
        } catch (error: any) {
            console.log(`\nRequest aborted: ${error.message}`);
        }
    })();

    // Abort after 1 second
    setTimeout(() => {
        console.log('\nAborting request...');
        abortController.abort();
    }, 1000);

    await abortableRequest;

    // Clean up
    resume();
    console.log('\n\n=== Pause Control Example Complete ===');
}

// Usage in a real application:
//
// import { pause, resume, isPaused } from '@ensemble/core';
//
// // In your UI or API:
// app.post('/api/pause', (req, res) => {
//     pause();
//     res.json({ status: 'paused' });
// });
//
// app.post('/api/resume', (req, res) => {
//     resume();
//     res.json({ status: 'resumed' });
// });
//
// app.get('/api/status', (req, res) => {
//     res.json({ paused: isPaused() });
// });

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
