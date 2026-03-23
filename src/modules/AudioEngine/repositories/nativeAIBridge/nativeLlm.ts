import { invokeAI } from './isTauri';

export type NativeLlmStatus = {
    loaded: boolean;
    model_path: string | null;
    backend: string;
};

export async function loadNativeModel(modelPath: string): Promise<NativeLlmStatus> {
    return (await invokeAI('load_native_model', { modelPath })) as NativeLlmStatus;
}

export async function nativeInference(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number; grammar?: string }
): Promise<string> {
    return (await invokeAI('native_inference', {
        request: {
            system_prompt: systemPrompt,
            user_message: userMessage,
            temperature: options?.temperature,
            max_tokens: options?.maxTokens,
            grammar: options?.grammar,
        },
    })) as string;
}

export async function unloadNativeModel(): Promise<void> {
    await invokeAI('unload_native_model');
}
