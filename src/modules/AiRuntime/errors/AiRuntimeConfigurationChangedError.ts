export class AiRuntimeConfigurationChangedError extends Error {
    override readonly name = 'AiRuntimeConfigurationChangedError';

    constructor() {
        super('AI configuration changed while the request was running');
    }
}

export function isAiRuntimeConfigurationChangedError(error: unknown): error is AiRuntimeConfigurationChangedError {
    return error instanceof Error && error.name === 'AiRuntimeConfigurationChangedError';
}
