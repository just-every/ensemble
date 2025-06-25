/**
 * Example: Automatic Cost Event Tracking
 *
 * This example demonstrates how cost_update events are automatically emitted
 * whenever token usage is recorded by the costTracker.
 */

import { ensembleRequest, setEventHandler, CostUpdateEvent, ProviderStreamEvent } from '@just-every/ensemble';

async function main() {
    console.log('=== Automatic Cost Event Tracking Example ===\n');

    // Track total costs across all requests
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let eventCount = 0;

    // Set up global event handler to capture cost_update events
    setEventHandler((event: ProviderStreamEvent) => {
        if (event.type === 'cost_update') {
            const costEvent = event as CostUpdateEvent;
            eventCount++;

            totalInputTokens += costEvent.usage.input_tokens;
            totalOutputTokens += costEvent.usage.output_tokens;

            console.log(`[Cost Update #${eventCount}]`);
            console.log(`  Input tokens: ${costEvent.usage.input_tokens}`);
            console.log(`  Output tokens: ${costEvent.usage.output_tokens}`);
            console.log(`  Total tokens: ${costEvent.usage.total_tokens}`);
            if (costEvent.usage.cached_tokens) {
                console.log(`  Cached tokens: ${costEvent.usage.cached_tokens}`);
            }
            console.log(`  Running totals - Input: ${totalInputTokens}, Output: ${totalOutputTokens}\n`);
        }
    });

    try {
        // Make multiple requests to see cost events
        console.log('Making first request...\n');

        const messages1 = [{ role: 'user' as const, content: 'What is 2+2?' }];

        for await (const event of ensembleRequest(messages1, {
            model: 'gpt-3.5-turbo',
        })) {
            if (event.type === 'message_delta') {
                process.stdout.write(event.content);
            }
        }
        console.log('\n');

        // Make another request with a different model
        console.log('Making second request with different model...\n');

        const messages2 = [
            {
                role: 'user' as const,
                content: 'Explain quantum computing in one sentence.',
            },
        ];

        for await (const event of ensembleRequest(messages2, {
            model: 'claude-3-haiku',
        })) {
            if (event.type === 'message_delta') {
                process.stdout.write(event.content);
            }
        }
        console.log('\n');

        // Make a request with cached input (if supported by model)
        console.log('Making third request (may use cache if supported)...\n');

        const messages3 = [
            {
                role: 'system' as const,
                content:
                    'You are a helpful assistant. This is a long system message that might be cached by some providers.',
            },
            { role: 'user' as const, content: 'Hello!' },
        ];

        for await (const event of ensembleRequest(messages3, {
            model: 'gpt-4-turbo',
        })) {
            if (event.type === 'message_delta') {
                process.stdout.write(event.content);
            }
        }
        console.log('\n');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        // Clear the event handler
        setEventHandler(null);

        console.log('\n=== Final Cost Summary ===');
        console.log(`Total cost events received: ${eventCount}`);
        console.log(`Total input tokens: ${totalInputTokens}`);
        console.log(`Total output tokens: ${totalOutputTokens}`);
        console.log(`Total tokens: ${totalInputTokens + totalOutputTokens}`);
    }
}

// Advanced example: Building a cost monitoring service
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class CostMonitor {
    private costs: Map<string, { input: number; output: number; count: number }> = new Map();

    constructor() {
        // Set up event handler in constructor
        setEventHandler(this.handleEvent.bind(this));
    }

    private handleEvent(event: ProviderStreamEvent) {
        if (event.type === 'cost_update') {
            const costEvent = event as CostUpdateEvent;

            // In real implementation, you'd need to track which model this is for
            // This is a simplified example
            this.recordCost('unknown', costEvent.usage);
        }
    }

    private recordCost(model: string, usage: CostUpdateEvent['usage']) {
        const current = this.costs.get(model) || {
            input: 0,
            output: 0,
            count: 0,
        };

        this.costs.set(model, {
            input: current.input + usage.input_tokens,
            output: current.output + usage.output_tokens,
            count: current.count + 1,
        });
    }

    getCostReport() {
        const report: any = {};

        for (const [model, stats] of this.costs) {
            report[model] = {
                totalInputTokens: stats.input,
                totalOutputTokens: stats.output,
                totalTokens: stats.input + stats.output,
                requestCount: stats.count,
                averageTokensPerRequest: Math.round((stats.input + stats.output) / stats.count),
            };
        }

        return report;
    }

    destroy() {
        setEventHandler(null);
    }
}

// Run the main example if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
