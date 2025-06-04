/**
 * Tool Parameter Mapping Example
 * 
 * This example demonstrates how ensemble properly maps named parameters 
 * from LLM calls to positional function arguments when using createToolFunction.
 * 
 * The fix ensures that when LLMs call tools with named parameters via the args object,
 * ensemble correctly extracts and maps these to the positional parameters expected
 * by the original function.
 */

import { request, createToolFunction } from '../index.js';
import type { ResponseInput } from '../types.js';
import { mapNamedToPositionalArgs } from '../utils/tool_parameter_utils.js';

// Create a tool that expects positional parameters
const startTaskTool = createToolFunction(
    async (
        name: string,
        task: string,
        context: string,
        warnings: string,
        goal: string,
        type?: string,
        project?: string[]
    ) => {
        console.log('Parameters received:');
        console.log('- name:', name);
        console.log('- task:', task);
        console.log('- context:', context);
        console.log('- warnings:', warnings);
        console.log('- goal:', goal);
        console.log('- type:', type);
        console.log('- project:', project);
        
        return `Task "${name}" created successfully with type: ${type || 'default'}`;
    },
    'Start a new task with detailed parameters',
    {
        name: 'Task name',
        task: 'Task description',
        context: 'Task context',
        warnings: 'Any warnings',
        goal: 'Task goal',
        type: {
            type: 'string',
            description: 'Task type',
            enum: ['project_update', 'feature', 'bugfix', 'documentation'],
            optional: true
        },
        project: {
            type: 'array',
            description: 'Related projects',
            items: { type: 'string' },
            optional: true
        }
    }
);

async function main() {
    console.log('=== Tool Parameter Mapping Example ===\n');
    
    const messages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: `Start a task called "Self-Improvement Review" to review the existing 
            code for improvement opportunities. The context is that we're looking for 
            ways to enhance the codebase. No specific warnings. The goal is to analyze 
            the project and suggest improvements. This is a project_update type task 
            for the magi-self-improvement project.`
        }
    ];

    console.log('Calling LLM with tool...\n');
    
    const stream = request('gpt-4o-mini', messages, {
        tools: [startTaskTool],
        maxToolCalls: 1
    });

    for await (const event of stream) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        } else if (event.type === 'tool_start') {
            console.log('\n\n🔧 Tool call detected:');
            console.log('Function:', event.tool_calls[0].function.name);
            console.log('Arguments:', JSON.stringify(
                JSON.parse(event.tool_calls[0].function.arguments || '{}'), 
                null, 
                2
            ));
            console.log('\n📊 Executing tool...\n');
        } else if (event.type === 'tool_result') {
            console.log('\n✅ Tool result:', event.result);
        }
    }
    
    console.log('\n\n' + '='.repeat(50) + '\n');
    
    // Demonstrate direct parameter mapping
    console.log('Direct parameter mapping demonstration:\n');
    
    const namedArgs = {
        name: 'Manual Test',
        task: 'Test the mapping',
        context: 'Testing context',
        warnings: 'None',
        goal: 'Verify mapping works',
        type: 'test',
        project: ['test-project']
    };
    
    console.log('Named arguments from LLM:', JSON.stringify(namedArgs, null, 2));
    
    const positionalArgs = mapNamedToPositionalArgs(namedArgs, startTaskTool);
    console.log('\nMapped to positional arguments:', positionalArgs);
    
    const result = await startTaskTool.function(...positionalArgs);
    console.log('\nFunction result:', result);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}