/**
 * Example: Chaining multiple LLM requests
 * 
 * This example demonstrates how to use chainRequests to create
 * multi-step workflows where each model builds on the previous output.
 */

import { chainRequests } from '@just-every/ensemble';

async function main() {
    // Example 1: Code review workflow
    console.log('=== Code Review Workflow ===\n');
    
    const codeToReview = `
function processData(data) {
    let result = [];
    for (let i = 0; i <= data.length; i++) {
        if (data[i] > 0) {
            result.push(data[i] * 2);
        }
    }
    return result;
}`;

    const codeReviewResult = await chainRequests(
        [{ 
            type: 'message', 
            role: 'user', 
            content: `Review this JavaScript code:\n\`\`\`javascript\n${codeToReview}\n\`\`\`` 
        }],
        [
            {
                model: 'gpt-4o',
                systemPrompt: 'You are a senior code reviewer. Identify all bugs, potential issues, and code quality problems. Be thorough and specific.'
            },
            {
                model: 'claude-3.5-sonnet',
                systemPrompt: 'Based on the issues identified, provide specific fixes for each problem. Include corrected code snippets.'
            },
            {
                model: 'gpt-4o-mini',
                systemPrompt: 'Summarize the review findings and fixes in a concise format with: 1) Key issues found, 2) Recommended fixes, 3) Final corrected code.'
            }
        ]
    );
    
    console.log('Final Review Summary:');
    console.log(codeReviewResult.fullResponse);
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Example 2: Content creation workflow
    console.log('=== Content Creation Workflow ===\n');
    
    const contentResult = await chainRequests(
        [{ 
            type: 'message', 
            role: 'user', 
            content: 'Topic: The future of renewable energy' 
        }],
        [
            {
                model: 'claude-3.5-sonnet',
                systemPrompt: 'Generate a comprehensive outline for a blog post on the given topic. Include main sections and key points.'
            },
            {
                model: 'gpt-4o',
                systemPrompt: 'Expand the outline into a full blog post introduction (2-3 paragraphs) that hooks the reader.'
            },
            {
                model: 'gpt-4o-mini',
                systemPrompt: 'Create 5 engaging social media posts to promote this blog post. Include relevant hashtags.'
            }
        ]
    );
    
    console.log('Social Media Posts:');
    console.log(contentResult.fullResponse);
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Example 3: Data analysis workflow
    console.log('=== Data Analysis Workflow ===\n');
    
    const salesData = {
        Q1: { revenue: 250000, units: 1200 },
        Q2: { revenue: 280000, units: 1350 },
        Q3: { revenue: 195000, units: 950 },
        Q4: { revenue: 320000, units: 1500 }
    };
    
    const analysisResult = await chainRequests(
        [{ 
            type: 'message', 
            role: 'user', 
            content: `Analyze this sales data: ${JSON.stringify(salesData, null, 2)}` 
        }],
        [
            {
                model: 'gpt-4o',
                systemPrompt: 'Perform a detailed analysis of the sales data. Calculate key metrics, identify trends, and note any anomalies.'
            },
            {
                model: 'claude-3.5-sonnet',
                systemPrompt: 'Based on the analysis, provide strategic recommendations for improving sales performance.'
            },
            {
                model: 'gemini-2.0-flash',
                systemPrompt: 'Create a executive summary (max 100 words) highlighting the most important insights and top 3 action items.'
            }
        ]
    );
    
    console.log('Executive Summary:');
    console.log(analysisResult.fullResponse);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}