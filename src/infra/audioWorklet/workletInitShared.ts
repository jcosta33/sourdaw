/**
 * Shared helpers for WASM-backed AudioWorklet plugin node initialization.
 *
 * Consolidates the three duplicated patterns identified in audit §39.1/§39.2:
 *   1. Per-context worklet-module registration caching (`ensureWorkletRegistered`)
 *   2. Per-context WASM bundle-version ownership plus compiled-module caching
 *      (`fetchWasmModule`)
 *   3. "ready / error / timeout" handshake factory (`createReadyHandshake`)
 *
 * Used by every `create*Node` factory under `src/modules/AudioEngine/engine/`.
 *
 * Why a handshake factory rather than a hard-coded `onmessage` setter: some
 * nodes (ProofNode, LevainNode, GrinderNode, GrandBouleNode) need to layer
 * additional logic on top of the ready/error handshake (telemetry polling
 * setup, post-ready sample loading, post-settled runtime-fault warnings).
 * The handshake exposes an `onMessage` function that consumes each event and
 * reports whether it was handled, so callers can interleave their own logic
 * without duplicating the settled/timeout bookkeeping.
 *
 * All semantics (10s default timeout, error messages, settled-flag behaviour)
 * are preserved exactly — this is a pure refactor with no behaviour change.
 */

const DEFAULT_INIT_TIMEOUT_MS = 10_000;

/**
 * Cache of per-`BaseAudioContext` worklet-module `addModule` promises.
 *
 * `audioWorklet.addModule` is idempotent at the browser level, but awaiting
 * the second call still pays an extra microtask roundtrip. Caching the first
 * promise in a WeakMap lets concurrent creates share a single registration.
 */
const workletRegistrations = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

/**
 * Register an AudioWorklet module on the given context exactly once per
 * (context, url) pair. Returns the cached promise on subsequent calls.
 */
export async function ensureWorkletRegistered(ctx: BaseAudioContext, moduleUrl: string): Promise<void> {
    let contextMap = workletRegistrations.get(ctx);
    if (!contextMap) {
        contextMap = new Map();
        workletRegistrations.set(ctx, contextMap);
    }
    let promise = contextMap.get(moduleUrl);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(moduleUrl);
        contextMap.set(moduleUrl, promise);
    }
    return promise;
}

/**
 * URL-keyed cache of fetched and compiled WASM modules. Stores the in-flight
 * promise so concurrent callers share both network and compilation work.
 */
const wasmModuleCache = new Map<string, Promise<WebAssembly.Module>>();

type WasmBundleId = 'daw-dsp' | 'proof-chamber' | 'scoring';

type FetchWasmModuleInput = {
    ctx: BaseAudioContext;
    bundleId: WasmBundleId;
    url: string;
};

type WasmBundleLoad = {
    url: string;
    promise: Promise<WebAssembly.Module>;
};

/**
 * A loaded worklet realm owns one initialized wasm-bindgen singleton per
 * bundle. Passing a second module to the same generated glue does not replace
 * the first instance, so silently accepting another URL would report `ready`
 * while continuing to execute the old binary. Pin the bundle identity to its
 * `BaseAudioContext` and reject mixed versions before a node is constructed.
 */
const contextBundleLoads = new WeakMap<BaseAudioContext, Map<WasmBundleId, WasmBundleLoad>>();

function loadWasmModule(url: string): Promise<WebAssembly.Module> {
    const cached = wasmModuleCache.get(url);
    if (cached) {
        return cached;
    }

    const promise = fetch(url).then(async (response) => {
        if (!response.ok) {
            throw new Error(`Failed to fetch WASM (${url}): ${response.status}`);
        }
        const bytes = await response.arrayBuffer();
        return WebAssembly.compile(bytes);
    });
    wasmModuleCache.set(url, promise);
    promise.catch(() => {
        if (wasmModuleCache.get(url) === promise) {
            wasmModuleCache.delete(url);
        }
    });
    return promise;
}

/**
 * Claim one bundle version for this context, then fetch and asynchronously
 * compile its module once per URL. A compiled `WebAssembly.Module` is
 * structured-cloneable, so node factories can send the cached module to
 * worklets and workers without compiling synchronously on their
 * real-time-adjacent threads.
 */
export async function fetchWasmModule({ ctx, bundleId, url }: FetchWasmModuleInput): Promise<WebAssembly.Module> {
    let bundleLoads = contextBundleLoads.get(ctx);
    if (!bundleLoads) {
        bundleLoads = new Map();
        contextBundleLoads.set(ctx, bundleLoads);
    }

    const existing = bundleLoads.get(bundleId);
    if (existing) {
        if (existing.url !== url) {
            throw new Error(
                `WASM bundle "${bundleId}" is already bound to ${existing.url} in this AudioContext; ` +
                    `create a new AudioContext before loading ${url}`
            );
        }
        return existing.promise;
    }

    const promise = loadWasmModule(url);
    bundleLoads.set(bundleId, { url, promise });
    try {
        return await promise;
    } catch (error) {
        // A failed load did not initialize the bundle singleton, so release
        // this context's claim and allow a retry or an explicit replacement.
        if (bundleLoads.get(bundleId)?.promise === promise) {
            bundleLoads.delete(bundleId);
        }
        throw error;
    }
}

/**
 * Result of `createReadyHandshake` — a Promise that resolves on `ready` /
 * rejects on `error` or timeout, plus an `onMessage` consumer and an
 * `isSettled` predicate for callers that need to layer additional logic
 * onto the same message port.
 */
export type ReadyHandshakeResult = {
    /** Resolves with the ready event data; rejects on `{type: 'error'}` or timeout. */
    promise: Promise<Record<string, unknown>>;
    /**
     * Consume one message. Returns:
     *   - 'ready'   — this event completed the handshake (settled → resolved)
     *   - 'error'   — this event rejected the handshake (settled → rejected)
     *   - 'late'    — a ready/error event arrived after the handshake settled
     *                 (caller may want to log it as a runtime fault)
     *   - 'other'   — not a ready/error event; caller should process it
     */
    onMessage: (event: MessageEvent) => 'ready' | 'error' | 'late' | 'other';
    /** Reject from a transport-level failure such as Worker `error`. */
    reject: (error: Error) => 'error' | 'late';
    /** True once the handshake has resolved, rejected, or timed out. */
    isSettled: () => boolean;
};

export type CreateReadyHandshakeInput = {
    /** Human-readable name used in the timeout error message (e.g. 'BacteriaNode'). */
    pluginName: string;
    /** Defaults to 10_000 ms — match the original inline value. */
    timeoutMs?: number;
};

/**
 * Create a `ready / error / timeout` handshake. The returned Promise is
 * safe to return from the factory, and the returned `onMessage` consumer
 * can be wired directly as the port's message handler or composed with
 * additional caller logic.
 */
export function createReadyHandshake(input: CreateReadyHandshakeInput): ReadyHandshakeResult {
    const { pluginName, timeoutMs = DEFAULT_INIT_TIMEOUT_MS } = input;
    let settled = false;
    let resolveFn: (data: Record<string, unknown>) => void = () => {};
    let rejectFn: (reason: Error) => void = () => {};

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });

    const reject = (error: Error): 'error' | 'late' => {
        if (settled) {
            return 'late';
        }
        settled = true;
        clearTimeout(timeout);
        rejectFn(error);
        return 'error';
    };

    const timeout = setTimeout(() => {
        reject(new Error(`${pluginName} init timeout (${timeoutMs / 1000}s)`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent): 'ready' | 'error' | 'late' | 'other' => {
        const data: unknown = event.data;
        if (!data || typeof data !== 'object') {
            return 'other';
        }
        const type = (data as { type?: unknown }).type;
        if (type === 'ready') {
            if (settled) {
                return 'late';
            }
            settled = true;
            clearTimeout(timeout);
            resolveFn(data as Record<string, unknown>);
            return 'ready';
        }
        if (type === 'error') {
            if (settled) {
                return 'late';
            }
            const message = (data as { message?: unknown }).message;
            return reject(new Error(typeof message === 'string' ? message : `${pluginName} init error`));
        }
        return 'other';
    };

    return {
        promise,
        onMessage,
        reject,
        isSettled: () => settled,
    };
}
