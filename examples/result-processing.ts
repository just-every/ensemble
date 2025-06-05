/**
 * Result Processing Example
 * Demonstrates automatic summarization and truncation of tool results
 */

import { 
    ensembleRequest, 
    ToolFunction,
    processToolResult,
    shouldSummarizeResult,
    TOOL_CONFIGS,
    MAX_RESULT_LENGTH
} from '../index.js';

// Define tools that return different types of content
const tools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'generate_long_text',
                description: 'Generates a long text output',
                parameters: {
                    type: 'object',
                    properties: {
                        paragraphs: { type: 'number' }
                    },
                    required: ['paragraphs']
                }
            }
        },
        function: async (paragraphs: number) => {
            const lorem = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
                Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
                Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. `;
            
            let result = `Generated ${paragraphs} paragraphs:\n\n`;
            for (let i = 0; i < paragraphs; i++) {
                result += `Paragraph ${i + 1}: ${lorem}\n\n`;
            }
            
            console.log(`\n📝 Generated text with ${result.length} characters`);
            return result;
        }
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'read_source',
                description: 'Simulates reading source code (skip summarization)',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string' },
                        lines: { type: 'number' }
                    },
                    required: ['filename', 'lines']
                }
            }
        },
        function: async (filename: string, lines: number) => {
            let code = `// File: ${filename}\n`;
            for (let i = 1; i <= lines; i++) {
                code += `${i.toString().padStart(3, ' ')}: function example${i}() { return "This is line ${i} of the source code"; }\n`;
            }
            
            console.log(`\n📄 Generated ${lines} lines of code (${code.length} chars)`);
            return code;
        }
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'generate_json_data',
                description: 'Generates structured JSON data',
                parameters: {
                    type: 'object',
                    properties: {
                        records: { type: 'number' }
                    },
                    required: ['records']
                }
            }
        },
        function: async (records: number) => {
            const data = {
                metadata: {
                    generated: new Date().toISOString(),
                    count: records
                },
                records: [] as any[]
            };
            
            for (let i = 0; i < records; i++) {
                data.records.push({
                    id: i + 1,
                    name: `Record ${i + 1}`,
                    value: Math.random() * 1000,
                    timestamp: new Date(Date.now() - i * 1000000).toISOString(),
                    description: `This is a detailed description for record ${i + 1} with various properties`
                });
            }
            
            const result = JSON.stringify(data, null, 2);
            console.log(`\n📊 Generated JSON with ${result.length} characters`);
            return result;
        }
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'generate_image',
                description: 'Simulates generating an image',
                parameters: {
                    type: 'object',
                    properties: {
                        description: { type: 'string' }
                    },
                    required: ['description']
                }
            }
        },
        function: async (description: string) => {
            console.log(`\n🎨 Generating image: ${description}`);
            // Return a fake base64 image data URL
            return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`;
        }
    }
];

async function demonstrateProcessing() {
    console.log('\n' + '='.repeat(60));
    console.log('DIRECT RESULT PROCESSING DEMONSTRATION\n');
    
    // Example 1: Text that will be summarized
    const longText = 'This is a very long text. '.repeat(100);
    console.log(`1. Long text (${longText.length} chars):`);
    
    const toolCall1 = {
        id: 'test-1',
        type: 'function' as const,
        function: {
            name: 'generate_long_text',
            arguments: '{"paragraphs": 10}'
        }
    };
    
    if (shouldSummarizeResult('generate_long_text', longText.length)) {
        console.log('   ✅ Will be summarized');
    }
    
    const processed1 = await processToolResult(toolCall1, longText);
    console.log(`   Result: ${processed1.substring(0, 100)}...`);
    
    // Example 2: Source code (truncated, not summarized)
    const sourceCode = '// Source code\n'.repeat(100);
    console.log(`\n2. Source code (${sourceCode.length} chars):`);
    
    const toolCall2 = {
        id: 'test-2',
        type: 'function' as const,
        function: {
            name: 'read_source',
            arguments: '{"filename": "test.js", "lines": 100}'
        }
    };
    
    if (shouldSummarizeResult('read_source', sourceCode.length)) {
        console.log('   ❌ Will NOT be summarized (configured to skip)');
    } else {
        console.log('   ✂️  Will be truncated only');
    }
    
    const processed2 = await processToolResult(toolCall2, sourceCode);
    console.log(`   Result ends with: ...${processed2.substring(processed2.length - 100)}`);
}

async function main() {
    console.log('=== RESULT PROCESSING DEMONSTRATION ===\n');
    console.log(`Default max length before processing: ${MAX_RESULT_LENGTH} characters`);
    console.log('\nTools configured to skip summarization:', 
        Array.from(Object.entries(TOOL_CONFIGS))
            .filter(([_, config]) => config.skipSummarization)
            .map(([name]) => name)
            .join(', ')
    );

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: `Please demonstrate result processing:
1. Generate 20 paragraphs of text (will be summarized)
2. Read 100 lines of source code (will be truncated only)
3. Generate JSON data with 50 records (will be summarized)
4. Generate an image with description "sunset over mountains" (unchanged)`
        }
    ];

    const agent = {
        model: 'o4-mini',
        agent_id: 'result-processor',
        tools
    };

    console.log('\nUser:', messages[0].content);
    console.log('\n' + '='.repeat(60) + '\n');

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_delta':
                    process.stdout.write(event.content);
                    break;
                    
                case 'tool_done':
                    if (event.results) {
                        console.log('\n\n📊 Processed Results:');
                        event.results.forEach((result, i) => {
                            const lines = result.output.split('\n');
                            console.log(`\n${i + 1}. Tool output (${result.output.length} chars):`);
                            
                            if (result.output.startsWith('data:image/')) {
                                console.log('   [Base64 image data - returned unchanged]');
                            } else if (lines.length > 5) {
                                console.log('   First 3 lines:');
                                lines.slice(0, 3).forEach(line => 
                                    console.log(`   ${line.substring(0, 80)}${line.length > 80 ? '...' : ''}`));
                                console.log('   ...');
                                console.log('   Last line:');
                                console.log(`   ${lines[lines.length - 1].substring(0, 80)}${lines[lines.length - 1].length > 80 ? '...' : ''}`);
                            } else {
                                lines.forEach(line => 
                                    console.log(`   ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`));
                            }
                        });
                        console.log('\nAssistant continues:\n');
                    }
                    break;
            }
        }
        
        // Also demonstrate direct processing
        await demonstrateProcessing();
        
        console.log('\n' + '='.repeat(60));
        console.log('\nKey takeaways:');
        console.log('- Long general outputs are automatically summarized using LLM');
        console.log('- Code and specific tools are just truncated to preserve accuracy');
        console.log('- Images and binary data pass through unchanged');
        console.log('- Custom configurations can be added for any tool');
        
    } catch (error) {
        console.error('Error:', error);
    }
}

main().catch(console.error);