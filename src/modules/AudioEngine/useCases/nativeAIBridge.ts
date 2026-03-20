/**
 * Native AI Bridge.
 * TS-side interface for native LLM inference, AI MIDI generation,
 * and audio denoising via Tauri IPC.
 */

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function invokeAI(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauri()) {
        throw new Error('Native AI features require Tauri desktop environment');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
}

// ─── Native LLM ───────────────────────────────────────────

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

// ─── Tool Calling Pipeline ────────────────────────────────

export type ToolDefinition = {
    name: string;
    description: string;
    parameters_schema: Record<string, unknown>;
};

export type ToolCall = {
    tool_name: string;
    arguments: Record<string, unknown>;
};

export async function executeToolCalling(
    systemPrompt: string,
    userMessage: string,
    tools: ToolDefinition[],
    temperature?: number
): Promise<ToolCall[]> {
    return (await invokeAI('execute_tool_calling', {
        request: {
            system_prompt: systemPrompt,
            user_message: userMessage,
            tools,
            temperature,
        },
    })) as ToolCall[];
}

// ─── AI MIDI Generation ───────────────────────────────────

export type GeneratedNote = {
    pitch: number;
    velocity: number;
    start_beat: number;
    duration_beats: number;
};

export type MidiGenerationResult = {
    notes: GeneratedNote[];
    model_used: string;
    generation_time_ms: number;
};

export async function generateMidiAI(
    seedNotes: Array<[number, number, number, number]>,
    targetNotes = 16,
    temperature = 0.8,
    topK = 40
): Promise<MidiGenerationResult> {
    return (await invokeAI('generate_midi_ai', {
        request: {
            seed_notes: seedNotes,
            target_notes: targetNotes,
            temperature,
            top_k: topK,
        },
    })) as MidiGenerationResult;
}

// ─── Audio Denoising ──────────────────────────────────────

export type DenoiseResult = {
    samples: number[];
    noise_floor_db: number;
    processing_time_ms: number;
};

export async function denoiseAudio(
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    strength = 0.7
): Promise<DenoiseResult> {
    return (await invokeAI('denoise_audio', {
        request: {
            samples: Array.from(samples),
            sample_rate: sampleRate,
            channels,
            strength,
        },
    })) as DenoiseResult;
}
