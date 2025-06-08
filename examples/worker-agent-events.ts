/**
 * Example: Worker Agent Events
 *
 * This example demonstrates how to track events from worker agents
 * including their creation, execution, and completion.
 */

import { Agent } from '../utils/agent.js';
import { ProviderStreamEvent } from '../types/types.js';

async function main() {
    console.log('=== Worker Agent Events Example ===\n');

    // Create some worker agents
    const codeAgent = new Agent({
        name: 'CodeAgent',
        description: 'Writes and reviews code',
        modelClass: 'code',
        // You could add specific tools for code-related tasks
    });

    const searchAgent = new Agent({
        name: 'SearchAgent',
        description: 'Searches for information',
        modelClass: 'standard',
        // You could add search tools here
    });

    const researchAgent = new Agent({
        name: 'ResearchAgent',
        description: 'Conducts detailed research',
        modelClass: 'reasoning',
    });

    // Event tracking
    const events: ProviderStreamEvent[] = [];
    const agentHierarchy: Map<string, string[]> = new Map(); // parent_id -> child_ids

    // Create the main operator agent with event tracking
    const operatorAgent = new Agent({
        agent_id: 'operator-main',
        name: 'OperatorAgent',
        description: 'Coordinates multiple specialist agents',
        workers: [() => codeAgent, () => searchAgent, () => researchAgent],
        // Event handler to track all sub-agent activity
        onEvent: async (event: ProviderStreamEvent) => {
            events.push(event);

            // Track agent hierarchy
            if (
                event.type === 'agent_start' &&
                'parent_id' in event &&
                event.parent_id
            ) {
                if (!agentHierarchy.has(event.parent_id)) {
                    agentHierarchy.set(event.parent_id, []);
                }
                if ('agent' in event && event.agent?.agent_id) {
                    agentHierarchy
                        .get(event.parent_id)!
                        .push(event.agent.agent_id);
                }
            }

            // Log important events with indentation for hierarchy
            const indent = 'agent' in event && event.parent_id ? '  ' : '';

            switch (event.type) {
                case 'agent_start':
                    if ('agent' in event) {
                        console.log(
                            `${indent}🚀 Agent started: ${event.agent.name} (${event.agent.agent_id})`
                        );
                        if ('input' in event && event.input) {
                            console.log(
                                `${indent}   Task: ${event.input.split('\n')[0].replace('**Task:** ', '')}`
                            );
                        }
                    }
                    break;

                case 'agent_done':
                    if ('agent' in event) {
                        const status =
                            'status' in event && event.status === 'error'
                                ? ' ❌ ERROR'
                                : ' ✅';
                        console.log(
                            `${indent}🏁 Agent completed: ${event.agent.name}${status}`
                        );
                        if ('output' in event && event.output) {
                            const preview =
                                event.output.length > 100
                                    ? event.output.substring(0, 100) + '...'
                                    : event.output;
                            console.log(`${indent}   Result: ${preview}`);
                        }
                    }
                    break;

                case 'tool_start':
                    if ('tool_call' in event) {
                        console.log(
                            `${indent}🔧 Tool called: ${event.tool_call.function.name}`
                        );
                    }
                    break;

                case 'error':
                    console.log(`${indent}❌ Error: ${event.error}`);
                    break;

                case 'message_delta':
                    // Show streaming content for main agent only
                    if (!('parent_id' in event) || !event.parent_id) {
                        process.stdout.write(event.content || '');
                    }
                    break;
            }
        },
    });

    console.log('Executing operator agent with worker delegation...\n');

    // Simulate a complex task that requires multiple specialists
    const task = `I need help building a simple web application that displays real-time cryptocurrency prices. 

Please:
1. Research the best free APIs for cryptocurrency data
2. Write the HTML, CSS, and JavaScript code for the application  
3. Make sure the code follows best practices

Coordinate between your specialist agents to complete this task.`;

    try {
        // This will trigger worker agents as needed
        const tools = await operatorAgent.getTools();

        // Simulate calling different workers
        console.log('--- Delegating research task to ResearchAgent ---');
        const researchTool = tools.find(t =>
            t.definition.function.name.includes('ResearchAgent')
        );
        if (researchTool) {
            await researchTool.function({
                task: 'Research free cryptocurrency price APIs',
                context: 'We need to build a real-time price display web app',
                goal: 'Find the best API with good documentation and no API key required',
            });
        }

        console.log('\n--- Delegating coding task to CodeAgent ---');
        const codeTool = tools.find(t =>
            t.definition.function.name.includes('CodeAgent')
        );
        if (codeTool) {
            await codeTool.function({
                task: 'Write HTML, CSS, and JavaScript for cryptocurrency price display',
                context:
                    'Based on the research, create a simple web application',
                goal: 'Clean, responsive code that fetches and displays crypto prices',
            });
        }

        console.log('\n--- Delegating additional search to SearchAgent ---');
        const searchTool = tools.find(t =>
            t.definition.function.name.includes('SearchAgent')
        );
        if (searchTool) {
            await searchTool.function({
                task: 'Find examples of similar cryptocurrency dashboard UIs',
                context:
                    'Looking for UI/UX inspiration for our price display app',
                goal: 'Gather design ideas and best practices',
            });
        }
    } catch (error) {
        console.error('Error during execution:', error);
    }

    // Display summary
    console.log('\n\n=== Execution Summary ===');
    console.log(`Total events captured: ${events.length}`);

    const agentStarts = events.filter(e => e.type === 'agent_start');
    const agentDones = events.filter(e => e.type === 'agent_done');
    const errors = events.filter(e => e.type === 'error');

    console.log(`Agent executions: ${agentStarts.length}`);
    console.log(`Completed agents: ${agentDones.length}`);
    console.log(`Errors: ${errors.length}`);

    if (agentHierarchy.size > 0) {
        console.log('\nAgent Hierarchy:');
        for (const [parentId, childIds] of agentHierarchy) {
            console.log(`  ${parentId} -> [${childIds.join(', ')}]`);
        }
    }

    // Show event timeline
    console.log('\nEvent Timeline:');
    events.forEach((event, i) => {
        const timestamp = event.timestamp || 'unknown';
        const time = new Date(timestamp).toLocaleTimeString();

        if (event.type === 'agent_start' && 'agent' in event) {
            console.log(`  ${time}: ${event.type} - ${event.agent.name}`);
        } else if (event.type === 'agent_done' && 'agent' in event) {
            console.log(`  ${time}: ${event.type} - ${event.agent.name}`);
        } else if (['tool_start', 'error'].includes(event.type)) {
            console.log(`  ${time}: ${event.type}`);
        }
    });
}

// Usage in a real application:
//
// const agent = new Agent({
//     name: 'MainAgent',
//     workers: [createWorker1, createWorker2],
//     onEvent: async (event) => {
//         // Send to your event bus, WebSocket, or UI
//         eventBus.emit('agent-event', event);
//
//         // Update progress bars, logs, etc.
//         if (event.type === 'agent_start') {
//             ui.showProgress(`Starting ${event.agent.name}...`);
//         }
//
//         // Track costs and usage
//         if (event.type === 'cost_update') {
//             costTracker.add(event.usage);
//         }
//
//         // Implement pause/resume
//         if (shouldPause && event.type === 'agent_start') {
//             await waitForUserInput();
//         }
//     }
// });

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
