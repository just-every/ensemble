import { describe, it, expect } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { setEnsembleLogger } from '../utils/llm_logger.js';

const liveKey = process.env.LIVE_GOOGLE_API_KEY;
const hasRealGoogleKey = !!liveKey;

const liveIt = hasRealGoogleKey ? it : it.skip;

describe('Gemini code execution tool (live)', () => {
    liveIt(
        'adds codeExecution tool group when code_execution tool is present',
        async () => {
            if (!liveKey) {
                throw new Error('LIVE_GOOGLE_API_KEY is required to run this test');
            }

            process.env.GOOGLE_API_KEY = liveKey;

            const agent = {
                model: 'gemini-3-flash-preview',
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'code_execution',
                                description: 'Enable Gemini native code execution',
                                parameters: {
                                    type: 'object',
                                    properties: {},
                                    required: [],
                                },
                            },
                        },
                        function: async () => '',
                    },
                ],
            };

            const messages = [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Reply with a short greeting.',
                },
            ];

            let capturedRequest: any | null = null;
            setEnsembleLogger({
                log_llm_request: (_agentId, providerName, model, requestData) => {
                    if (providerName === 'google' && model === 'gemini-3-flash-preview') {
                        capturedRequest = requestData as any;
                    }
                    return 'gemini-code-execution-test';
                },
                log_llm_response: () => {},
                log_llm_error: () => {},
            });

            try {
                for await (const event of ensembleRequest(messages, agent)) {
                    if (event.type === 'message_complete') {
                        break;
                    }
                }
            } finally {
                setEnsembleLogger(null);
            }

            expect(capturedRequest).toBeTruthy();
            const toolGroups = capturedRequest?.config?.tools || [];
            expect(toolGroups.some((group: any) => 'codeExecution' in group)).toBe(true);
            expect(toolGroups.some((group: any) => 'functionDeclarations' in group)).toBe(false);
            expect(capturedRequest?.config?.toolConfig).toBeUndefined();
        },
        30000
    );
});
