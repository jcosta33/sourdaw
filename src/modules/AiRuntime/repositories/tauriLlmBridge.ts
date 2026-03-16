type LlmRequest = {
    prompt: string;
    max_tokens?: number;
    temperature?: number;
};

type LlmResponse = {
    text: string;
    tokens_used: number;
    model: string;
};

type LlmStatus = {
    loaded: boolean;
    model_name: string | null;
    model_size_mb: number | null;
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

export const invokeLlm = async (request: LlmRequest): Promise<LlmResponse> => {
    return invoke("invoke_llm", { request }) as Promise<LlmResponse>;
};

export const getLlmStatus = async (): Promise<LlmStatus> => {
    return invoke("get_llm_status") as Promise<LlmStatus>;
};

export const isDesktopRuntime = (): boolean => isTauri();
