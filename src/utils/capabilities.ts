/**
 * Centralised runtime-capability detection.
 *
 * Per the systemic-issues audit (§10.2 item 7, §8.2 / §8.3 / §8.4 / N15), every
 * branch that asked "are we in Tauri?" / "do we have SharedArrayBuffer?" /
 * "does this model support the tools API?" lived at its own call site. That
 * scattered ownership caused three distinct production regressions, so the
 * canonical checks now live here and every runtime guard must route through
 * this module.
 *
 * All probes are cheap and synchronous — do not cache results across reloads,
 * because the Tauri webview injects `__TAURI_INTERNALS__` lazily during boot.
 */

import { logger } from '#/infra/logger/appLogger';
import { isTauri } from './tauriBridge';

export { isTauri };

/** `true` when `SharedArrayBuffer` is available at runtime. */
export function hasSharedArrayBuffer(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
}

/**
 * `true` when the page is cross-origin isolated (COOP/COEP applied).
 * Required for SharedArrayBuffer-backed WASM DSP (Grand Boule, Gluten, Proof).
 */
export function isCrossOriginIsolated(): boolean {
    return typeof globalThis !== 'undefined' && Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);
}

/**
 * Allowlist of LLM model IDs that are known to support the
 * `ChatCompletionRequest.tools` API.
 *
 * Empty for WebLLM (MLC) models: Qwen3 variants do not expose a tool-call API
 * and route via the XML/JSON prompt shim in `generateWebLlmToolCalls`.
 * Cloud models (Anthropic/OpenAI) handle tools via their own SDKs and never
 * consult this flag.
 *
 * Add a model ID here only after verifying end-to-end that the native
 * `tools` payload produces usable completions — do NOT guess.
 */
const MODELS_WITH_TOOLS_API: readonly string[] = [];

/**
 * Whether the given model ID supports the native `tools` array on
 * `ChatCompletionRequest`. Used to gate any WebLLM call site that might
 * otherwise attach `tools:` and hit `UnsupportedModelIdError`.
 */
export function supportsToolsApi(modelId: string): boolean {
    return MODELS_WITH_TOOLS_API.includes(modelId);
}

/**
 * Bundle of runtime capabilities. Kept as a plain value so tests can diff it
 * and the boot banner can render it without calling the probes individually.
 */
export type RuntimeCapabilities = {
    isTauri: boolean;
    hasSharedArrayBuffer: boolean;
    isCrossOriginIsolated: boolean;
};

export function getRuntimeCapabilities(): RuntimeCapabilities {
    return {
        isTauri: isTauri(),
        hasSharedArrayBuffer: hasSharedArrayBuffer(),
        isCrossOriginIsolated: isCrossOriginIsolated(),
    };
}

/**
 * Boot-time probe. Logs a single structured line at info level so the banner
 * is obvious in both web and Tauri dev consoles. Warns when
 * `crossOriginIsolated` is false because that silently disables every
 * SAB-backed DSP plugin — historically a top source of "plugin loaded but
 * produces no sound" reports.
 */
export function logCapabilities(): void {
    const capabilities = getRuntimeCapabilities();
    logger.info(`[capabilities] ${JSON.stringify(capabilities)}`);
    if (!capabilities.isCrossOriginIsolated) {
        logger.warn(
            '[capabilities] crossOriginIsolated=false — SharedArrayBuffer-backed plugins (Grand Boule, Gluten, Proof) will fail to instantiate. Check COOP/COEP headers.'
        );
    }
}
