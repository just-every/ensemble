/**
 * Sequential Tools Example
 * Demonstrates tools executing one at a time
 */

import { ensembleRequest, ToolFunction } from '../index.js';

// Define tools that have dependencies on each other
const tools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'create_file',
                description: 'Creates a file with content',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string' },
                        content: { type: 'string' }
                    },
                    required: ['filename', 'content']
                }
            }
        },
        function: async (filename: string, content: string) => {
            console.log(`\n📝 Creating file: ${filename}`);
            // Simulate file creation
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Store in memory for demo
            (global as any).files = (global as any).files || {};
            (global as any).files[filename] = content;
            
            return `File ${filename} created with ${content.length} characters`;
        }
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'read_file',
                description: 'Reads content from a file',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string' }
                    },
                    required: ['filename']
                }
            }
        },
        function: async (filename: string) => {
            console.log(`\n📖 Reading file: ${filename}`);
            // Simulate file read
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const files = (global as any).files || {};
            if (!files[filename]) {
                return `Error: File ${filename} not found`;
            }
            
            return `Content of ${filename}: ${files[filename]}`;
        }
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'append_to_file',
                description: 'Appends content to an existing file',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string' },
                        content: { type: 'string' }
                    },
                    required: ['filename', 'content']
                }
            }
        },
        function: async (filename: string, content: string) => {
            console.log(`\n✏️  Appending to file: ${filename}`);
            // Simulate file append
            await new Promise(resolve => setTimeout(resolve, 750));
            
            const files = (global as any).files || {};
            if (!files[filename]) {
                return `Error: File ${filename} not found`;
            }
            
            files[filename] += '\n' + content;
            return `Appended ${content.length} characters to ${filename}`;
        }
    }
];

async function main() {
    // Test both parallel and sequential execution
    console.log('=== DEMONSTRATION: Sequential vs Parallel Tool Execution ===\n');
    
    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: `Please perform these file operations:
1. Create a file called "test.txt" with content "Hello World"
2. Read the file "test.txt"
3. Append "Sequential execution ensures this works!" to "test.txt"
4. Read the file again to show the updated content`
        }
    ];

    // First, show what happens with parallel execution (default)
    console.log('1️⃣  PARALLEL EXECUTION (Default - might fail):\n');
    await runExample(messages, false);
    
    // Clear the files
    (global as any).files = {};
    
    // Then show sequential execution
    console.log('\n\n2️⃣  SEQUENTIAL EXECUTION (Safe for dependent operations):\n');
    await runExample(messages, true);
}

async function runExample(messages: any[], sequential: boolean) {
    const agent = {
        model: 'o4-mini',
        agent_id: 'file-manager',
        tools,
        modelSettings: {
            sequential_tools: sequential
        }
    };

    const startTime = Date.now();

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_delta':
                    process.stdout.write(event.content);
                    break;
                    
                case 'tool_start':
                    console.log(`\n🔧 Starting tool execution (${sequential ? 'SEQUENTIAL' : 'PARALLEL'} mode):`);
                    event.tool_calls.forEach((call, i) => {
                        console.log(`   ${i + 1}. ${call.function.name}(${call.function.arguments})`);
                    });
                    console.log('');
                    break;
                    
                case 'tool_done':
                    const duration = Date.now() - startTime;
                    console.log(`\n⏱️  Total execution time: ${duration}ms`);
                    
                    if (event.results) {
                        console.log('\n📊 Results:');
                        event.results.forEach((result, i) => {
                            console.log(`   ${i + 1}. ${result.output}`);
                        });
                    }
                    console.log('\nAssistant continues:\n');
                    break;
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

main().catch(console.error);