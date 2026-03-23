/**
 * llama-server sidecar lifecycle management.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';

import { NATIVE_MODEL_INFO } from '../../models/ModelInfo';

const logger = Container.getInstance().get(Logger);

export const SIDECAR_PORT = parseInt(
    (import.meta.env.VITE_LLM_SIDECAR_PORT as string | undefined) ?? '8847',
    10
);
export const BASE_URL = `http://127.0.0.1:${String(SIDECAR_PORT)}`;

let sidecarRunning = false;

async function checkLlamaServerHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        return response.ok;
    } catch {
        return false;
    }
}

export async function initLlamaServer(): Promise<void> {
    if (isTauri()) {
        const modelDir = (await tauriInvoke('get_model_dir')) as string;
        const modelPath = `${modelDir}/${NATIVE_MODEL_INFO.fileName}`;

        logger.info(`[Native AI] Starting sidecar with model: ${modelPath}`);

        await tauriInvoke('start_llm_sidecar', {
            request: {
                model_path: modelPath,
                port: SIDECAR_PORT,
                n_gpu_layers: 99,
                ctx_size: 4096,
            },
        });

        sidecarRunning = true;
        logger.info(`[Native AI] Sidecar started on port ${String(SIDECAR_PORT)}`);
        return;
    }

    logger.info('[Native AI] Browser mode — checking if llama-server is running...');
    const healthy = await checkLlamaServerHealth();
    if (healthy) {
        sidecarRunning = true;
        logger.info(`[Native AI] Connected to llama-server on port ${String(SIDECAR_PORT)}`);
        return;
    }

    throw new Error(
        `llama-server not reachable at ${BASE_URL}. ` +
            `Start it manually: llama-server --model <path-to-gguf> --port ${String(SIDECAR_PORT)} --host 127.0.0.1 --n-gpu-layers 99`
    );
}

export async function stopLlamaServer(): Promise<void> {
    if (isTauri()) {
        await tauriInvoke('stop_llm_sidecar');
    }
    sidecarRunning = false;
    logger.info('[Native AI] Sidecar stopped');
}

export function isLlamaServerRunning(): boolean {
    return sidecarRunning;
}
