// LLM Web Worker — runs MLCEngine in a background thread so inference
// never blocks the main thread. Vite bundles this as a separate chunk through the
// `new Worker(new URL(...))` in initWebLlmEngine.ts.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
    handler.onmessage(msg);
};
