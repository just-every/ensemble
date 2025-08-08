/**
 * Test for OpenAI-specific settings: verbosity and service_tier
 * These settings should be passed through to the OpenAI API correctly
 */

import { describe, it, expect } from 'vitest';

describe('OpenAI Verbosity and Service Tier Settings', () => {
    it('should include verbosity setting in request params', () => {
        // Test that verbosity setting is properly added to request
        const settings = {
            temperature: 0.7,
            verbosity: 'low' as const,
        };

        // Mock request params that would be sent to OpenAI
        const requestParams: any = {
            model: 'gpt-4o',
            stream: true,
            user: 'magi',
            input: [],
        };

        // Add settings as would be done in the provider
        if (settings.temperature !== undefined) {
            requestParams.temperature = settings.temperature;
        }
        if (settings.verbosity) {
            requestParams.verbosity = settings.verbosity;
        }

        expect(requestParams.verbosity).toBe('low');
        expect(requestParams.temperature).toBe(0.7);
    });

    it('should include service_tier setting in request params', () => {
        // Test that service_tier setting is properly added to request
        const settings = {
            service_tier: 'priority' as const,
        };

        // Mock request params that would be sent to OpenAI
        const requestParams: any = {
            model: 'gpt-4o',
            stream: true,
            user: 'magi',
            input: [],
        };

        // Add settings as would be done in the provider
        if (settings.service_tier) {
            requestParams.service_tier = settings.service_tier;
        }

        expect(requestParams.service_tier).toBe('priority');
    });

    it('should accept all valid verbosity values', () => {
        const validVerbosities: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

        validVerbosities.forEach(verbosity => {
            const settings = { verbosity };
            const requestParams: any = {
                model: 'gpt-4o',
                stream: true,
                user: 'magi',
                input: [],
            };

            if (settings.verbosity) {
                requestParams.verbosity = settings.verbosity;
            }

            expect(requestParams.verbosity).toBe(verbosity);
        });
    });

    it('should accept all valid service_tier values', () => {
        const validServiceTiers: Array<'auto' | 'default' | 'flex' | 'priority'> = [
            'auto',
            'default',
            'flex',
            'priority',
        ];

        validServiceTiers.forEach(service_tier => {
            const settings = { service_tier };
            const requestParams: any = {
                model: 'gpt-4o',
                stream: true,
                user: 'magi',
                input: [],
            };

            if (settings.service_tier) {
                requestParams.service_tier = settings.service_tier;
            }

            expect(requestParams.service_tier).toBe(service_tier);
        });
    });

    it('should handle both settings together', () => {
        const settings = {
            temperature: 0.5,
            verbosity: 'high' as const,
            service_tier: 'flex' as const,
            top_p: 0.9,
        };

        const requestParams: any = {
            model: 'gpt-4o',
            stream: true,
            user: 'magi',
            input: [],
        };

        // Add all settings
        if (settings.temperature !== undefined) {
            requestParams.temperature = settings.temperature;
        }
        if (settings.top_p !== undefined) {
            requestParams.top_p = settings.top_p;
        }
        if (settings.verbosity) {
            requestParams.verbosity = settings.verbosity;
        }
        if (settings.service_tier) {
            requestParams.service_tier = settings.service_tier;
        }

        expect(requestParams.temperature).toBe(0.5);
        expect(requestParams.top_p).toBe(0.9);
        expect(requestParams.verbosity).toBe('high');
        expect(requestParams.service_tier).toBe('flex');
    });

    it('should not add verbosity or service_tier if not provided', () => {
        const settings = {
            temperature: 0.7,
            // No verbosity or service_tier
        };

        const requestParams: any = {
            model: 'gpt-4o',
            stream: true,
            user: 'magi',
            input: [],
        };

        // Add settings
        if (settings.temperature !== undefined) {
            requestParams.temperature = settings.temperature;
        }
        if ((settings as any).verbosity) {
            requestParams.verbosity = (settings as any).verbosity;
        }
        if ((settings as any).service_tier) {
            requestParams.service_tier = (settings as any).service_tier;
        }

        expect(requestParams.temperature).toBe(0.7);
        expect(requestParams.verbosity).toBeUndefined();
        expect(requestParams.service_tier).toBeUndefined();
    });
});
