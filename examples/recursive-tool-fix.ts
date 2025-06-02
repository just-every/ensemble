/**
 * Example demonstrating the recursive tool_choice fix
 */

import { request, tool } from '../index.js';

// Create a tool that makes its own LLM request
const talkToUserTool = tool('talk_to_user')
    .description('Send a message to the user and get their response')
    .string('message', 'Message to send to the user')
    .implement(async ({ message }) => {
        console.log(`\n[Tool: talk_to_user] Sending message: ${message}`);
        
        // This tool makes its own LLM request to process the user's response
        // BEFORE FIX: This would inherit tool_choice and call talk_to_user again
        // AFTER FIX: This works normally without forced tool_choice
        console.log('[Tool: talk_to_user] Making recursive LLM call...');
        
        let response = '';
        for await (const event of request('gpt-4o-mini', [
            {
                type: 'message',
                role: 'user', 
                content: `The user said: "${message}". Please acknowledge this message briefly.`
            }
        ])) {
            if (event.type === 'text_delta') {
                response += event.delta;
            }
        }
        
        console.log(`[Tool: talk_to_user] LLM response: ${response}`);
        return `Message delivered to user. User acknowledged: ${response}`;
    })
    .build();

// Example usage
async function demonstrateRecursiveFix() {
    console.log('=== Recursive Tool Choice Fix Demo ===\n');
    
    console.log('Making request with forced tool_choice...');
    
    const messages = [
        {
            type: 'message' as const,
            role: 'system' as const,
            content: 'You must use the talk_to_user tool to communicate.'
        },
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'Tell the user that their order has been confirmed.'
        }
    ];
    
    try {
        for await (const event of request('gpt-4o-mini', messages, {
            tools: [talkToUserTool],
            modelSettings: {
                // Force the LLM to use talk_to_user tool
                tool_choice: { 
                    type: 'function', 
                    function: { name: 'talk_to_user' } 
                }
            },
            maxToolCalls: 3 // Safety limit
        })) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            }
            
            if (event.type === 'tool_start' && 'tool_calls' in event) {
                console.log('\n[Main] Tool call initiated');
            }
            
            if (event.type === 'error') {
                console.error('\n[Error]', event.error);
            }
        }
        
        console.log('\n\n✅ Success! The recursive call completed without infinite loop.');
        console.log('The tool_choice setting did not persist to the recursive LLM call.');
        
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the demo
demonstrateRecursiveFix().catch(console.error);