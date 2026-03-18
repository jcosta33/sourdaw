// LLM Web Worker — runs MLCEngine in a background thread so inference
// never blocks the main thread. Vite bundles this as a separate chunk via ?worker.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
    handler.onmessage(msg);
};
