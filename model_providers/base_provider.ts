import { ModelProvider } from './model_provider.js';
import { ModelProviderID } from '../data/model_data.js';
import {
    ProviderStreamEvent,
    ResponseInput,
    AgentDefinition,
} from '../types/types.js';
import { isValidBase64, detectImageType } from '../utils/image_validation.js';

/**
 * Abstract base class for model providers that implements common functionality
 */
export abstract class BaseModelProvider implements ModelProvider {
    constructor(protected providerId: ModelProviderID) {}

    abstract createResponseStream(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition
    ): AsyncGenerator<ProviderStreamEvent>;

    /**
     * Validate base64 string
     * @deprecated Use isValidBase64 from utils/image_validation.js
     */
    protected isValidBase64(str: string): boolean {
        return isValidBase64(str);
    }

    /**
     * Detect image type from base64 data
     * @deprecated Use detectImageType from utils/image_validation.js
     */
    protected detectImageType(base64Data: string): string | null {
        return detectImageType(base64Data);
    }
}
