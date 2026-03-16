import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";

export type LlmEngineStatus =
    | { state: "idle" }
    | { state: "loading"; progress: number; text: string }
    | { state: "ready"; modelId: string }
    | { state: "generating" }
    | { state: "error"; message: string };

const MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

const logger = Container.getInstance().get(Logger);
export const llmStatusStore = new Store<LlmEngineStatus>(logger, {
    initialData: { state: "idle" },
});

type WebLlmModule = typeof import("@mlc-ai/web-llm");
type MLCEngineInstance = Awaited<ReturnType<WebLlmModule["CreateMLCEngine"]>>;

let engine: MLCEngineInstance | null = null;
let initPromise: Promise<MLCEngineInstance> | null = null;

export const initLlmEngine = (): Promise<MLCEngineInstance> => {
    if (engine) return Promise.resolve(engine);
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            llmStatusStore.set({ state: "loading", progress: 0, text: "Loading AI engine..." });

            const { CreateMLCEngine } = await import("@mlc-ai/web-llm");

            const created = await CreateMLCEngine(MODEL_ID, {
                initProgressCallback: (report) => {
                    llmStatusStore.set({
                        state: "loading",
                        progress: report.progress,
                        text: report.text,
                    });
                },
            });

            engine = created;
            llmStatusStore.set({ state: "ready", modelId: MODEL_ID });
            return created;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            llmStatusStore.set({ state: "error", message });
            initPromise = null;
            throw err;
        }
    })();

    return initPromise;
};

export const generateActions = async (
    systemPrompt: string,
    userMessage: string,
    _jsonSchema: Record<string, unknown>,
): Promise<string> => {
    const eng = await initLlmEngine();
    llmStatusStore.set({ state: "generating" });

    try {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ];

        const response = await eng.chat.completions.create({
            messages,
            temperature: 0.1,
            max_tokens: 1024,
            response_format: {
                type: "json_object",
                schema: JSON.stringify(_jsonSchema),
            },
        });

        const text = response.choices[0]?.message?.content ?? "[]";
        llmStatusStore.set({ state: "ready", modelId: MODEL_ID });
        return text;
    } catch (err) {
        llmStatusStore.set({ state: "ready", modelId: MODEL_ID });
        throw err;
    }
};

export const isLlmAvailable = (): boolean => {
    return typeof navigator !== "undefined" && "gpu" in navigator;
};

export const getLlmEngine = (): MLCEngineInstance | null => engine;
