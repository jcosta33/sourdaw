type TranscriptionResult = {
    text: string;
    language: string;
    duration_ms: number;
    confidence: number;
};

type AsrStatus = {
    loaded: boolean;
    model_name: string | null;
};

const isTauri = (): boolean => "__TAURI__" in window;

const invoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (!isTauri()) {
        throw new Error("Tauri runtime not available — running in browser mode");
    }
    const w = window as unknown as Record<string, unknown>;
    const tauri = w.__TAURI__ as { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } | undefined;
    if (!tauri?.invoke) throw new Error("Tauri invoke not found");
    return tauri.invoke(cmd, args);
};

export const transcribeAudio = async (audioPath: string): Promise<TranscriptionResult> => {
    return invoke("transcribe_audio", { audioPath }) as Promise<TranscriptionResult>;
};

export const getAsrStatus = async (): Promise<AsrStatus> => {
    return invoke("get_asr_status") as Promise<AsrStatus>;
};
