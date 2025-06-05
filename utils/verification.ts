/**
 * Verification utilities for validating agent outputs
 */

import {
    ResponseInput,
    AgentDefinition,
    ResponseJSONSchema,
    ResponseOutputMessage,
    ResponseInputMessage,
} from '../types/types.js';
import { ensembleRequest } from '../core/ensemble_request.js';
import { convertStreamToMessages } from './stream_converter.js';

export interface VerificationResult {
    status: 'pass' | 'fail';
    reason?: string;
}

/**
 * Verify an agent's output using a verifier agent
 */
export async function verifyOutput(
    verifier: AgentDefinition,
    output: string,
    originalMessages: ResponseInput
): Promise<VerificationResult> {
    const verificationPrompt = `Please verify if the following output is correct and complete:

${output}

Respond with JSON: {"status": "pass"} or {"status": "fail", "reason": "explanation of what is wrong"}`;

    const verificationMessages: ResponseInput = [
        ...originalMessages,
        { type: 'message', role: 'assistant', content: output, status: 'completed' } as ResponseOutputMessage,
        { type: 'message', role: 'user', content: verificationPrompt } as ResponseInputMessage,
    ];

    // Create a verifier with JSON schema enforcement
    const verifierWithSchema: AgentDefinition = {
        ...verifier,
        jsonSchema: {
            type: 'json_schema',
            name: 'verification_result',
            schema: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['pass', 'fail'] },
                    reason: { type: 'string' },
                },
                required: ['status'],
            },
        } as ResponseJSONSchema,
    };

    try {
        const stream = ensembleRequest(verificationMessages, verifierWithSchema);
        const result = await convertStreamToMessages(
            stream,
            verificationMessages,
            verifierWithSchema
        );

        // Parse the JSON response
        const jsonResponse = JSON.parse(result.fullResponse);
        return jsonResponse;
    } catch (error) {
        console.error('Verification failed:', error);
        return {
            status: 'fail',
            reason: 'Invalid verification response',
        };
    }
}