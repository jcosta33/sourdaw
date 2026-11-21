import {
    DEFAULT_AUDIO_LATENCY_PROFILE,
    getAudioContextLatencyHint,
    readStoredAudioLatencyProfile,
    type AudioLatencyProfile,
} from '#/infra/audioContext/audioLatencyProfile';
import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { runAllAsyncEffects, runAllEffects } from '#/utils/runEffects';

import {
    bitcrusherRateProcessorUrl,
    meteringProcessorUrl,
    recordingProcessorUrl,
} from '../../engine/workletProcessorUrls';

import { createMasterSection, type MasterSection } from './createMasterSection';
import { createNoopAudioContext } from './createNoopAudioContext';

import type { TrackNode } from '../../engine/TrackNode';

export type AudioContextLatencyHint = 'interactive' | 'playback';

export type EngineLifecycle = {
    /** The live context, or the silent stand-in once the engine fell back. Read per call: it can be replaced. */
    context(): AudioContext;
    /** Writes the engine's public `context` field; every unit reads the new value through {@link context}. */
    replaceContext(context: AudioContext): void;
    /** The master section built on the context the engine opened. */
    master(): MasterSection;
    /** True when no AudioContext could be created and the engine runs on the silent fallback graph. */
    isFallback(): boolean;
    isDisposed(): boolean;
    /** Throws once the engine has been disposed. */
    assertActive(): void;
    isWorkletReady(): boolean;
    lastInitError(): Error | null;
    lastResumeError(): Error | null;
    /** The stored latency profile the context was opened with; `null` for a provided context. */
    readonly latencyProfile: AudioLatencyProfile | null;
    readonly latencyHint: AudioContextLatencyHint | null;
    initialize(): Promise<void>;
    resume(): Promise<void>;
    suspend(): Promise<void>;
    /** Tells the master meter and every strip worklet to stop before the graph is torn down. */
    postShutdownToWorklets(): void;
    /** Idempotent: every call returns the one cached disposal. */
    dispose(): Promise<void>;
};

export type EngineLifecyclePorts = Readonly<{
    providedContext?: AudioContext;
    /**
     * Constructs the app's one live AudioContext when none is provided. The
     * composer owns the construction site; a throw selects the fallback graph.
     */
    openLiveContext: (latencyHint: AudioContextLatencyHint) => AudioContext;
    /** The live strips whose worklets receive the shutdown message. */
    readTrackNodes: () => ReadonlyMap<string, TrackNode>;
    /**
     * The composer's ordered synchronous shutdown list, read when disposal runs
     * it. Context closure follows it and settles before the disposal resolves.
     */
    readDisposalEffects: () => Array<() => void>;
}>;

type OpenedGraph = Readonly<{ context: AudioContext; master: MasterSection; fallbackMode: boolean }>;

type LifecycleState = {
    context: AudioContext;
    readonly master: MasterSection;
    readonly fallbackMode: boolean;
    disposed: boolean;
    workletReady: boolean;
    initPromise: Promise<void> | null;
    initializationCancellation: PromiseWithResolvers<never> | null;
    initializationGeneration: number;
    disposalPromise: Promise<void> | null;
    lastInitError: Error | null;
    lastResumeError: Error | null;
};

function openFallbackGraph(): OpenedGraph {
    const context = createNoopAudioContext();
    return { context, master: createMasterSection({ context, mode: 'fallback' }), fallbackMode: true };
}

function openGraph(
    { providedContext, openLiveContext }: EngineLifecyclePorts,
    latencyHint: AudioContextLatencyHint | null
): OpenedGraph {
    try {
        const context =
            providedContext ??
            openLiveContext(latencyHint ?? getAudioContextLatencyHint(DEFAULT_AUDIO_LATENCY_PROFILE));
        return { context, master: createMasterSection({ context, mode: 'live' }), fallbackMode: false };
    } catch (error) {
        logger.warn(`Failed to create AudioContext: ${String(error)}`);
        notifyUser('Audio engine failed to initialize — audio playback is disabled. Try reloading the page.', 'error');
        return openFallbackGraph();
    }
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

async function loadWorklets(state: LifecycleState, generation: number): Promise<void> {
    const { audioWorklet } = state.context;
    await Promise.all([
        audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js'),
        audioWorklet.addModule(recordingProcessorUrl),
        audioWorklet.addModule(meteringProcessorUrl),
        audioWorklet.addModule(bitcrusherRateProcessorUrl),
    ]);
    if (generation !== state.initializationGeneration) {
        throw new Error('Audio engine was disposed during initialization.');
    }
    state.initializationCancellation = null;
    // The metering-processor module is now registered, so the master meter
    // can be inserted into the master chain. This cannot happen at
    // construction — the master nodes are built before any worklet module is
    // loaded (initialize() runs later), exactly like the per-track meter
    // which is built once metering-processor is available.
    state.master.wireMeter();
    state.workletReady = true;
    state.lastInitError = null;
}

function initialize(state: LifecycleState): Promise<void> {
    if (state.disposed) {
        return Promise.reject(new Error('Audio engine has been disposed.'));
    }
    if (state.fallbackMode) {
        return Promise.resolve();
    }
    if (state.initPromise) {
        return state.initPromise;
    }
    // Cache the in-flight/successful load so concurrent callers share it, but
    // do NOT cache a rejection: a failed worklet load (e.g. one addModule
    // 404s) must not poison the engine forever. On rejection we clear the
    // cached promise so the next initialize() retries the load.
    const generation = state.initializationGeneration;
    state.initializationCancellation = Promise.withResolvers<never>();
    state.initPromise = Promise.race([loadWorklets(state, generation), state.initializationCancellation.promise]).catch(
        (error: unknown) => {
            const initError = toError(error);
            if (generation === state.initializationGeneration) {
                state.initPromise = null;
                state.initializationCancellation = null;
                state.lastInitError = initError;
            }
            throw initError;
        }
    );
    return state.initPromise;
}

async function resume(state: LifecycleState): Promise<void> {
    if (state.fallbackMode) {
        return;
    }
    try {
        if (state.context.state === 'suspended') {
            await state.context.resume();
        }
        state.lastResumeError = null;
    } catch (error) {
        // Surface the failure instead of swallowing it: a gesture handler can
        // read getHealth().lastResumeError to re-arm / warn the user, and the
        // rejection now propagates so a `void resume()` caller no longer
        // silently leaves the context suspended (no audio).
        state.lastResumeError = toError(error);
        logger.warn(`AudioContext resume failed: ${String(error)}`);
        throw state.lastResumeError;
    }
}

async function suspend(state: LifecycleState): Promise<void> {
    if (state.fallbackMode) {
        return;
    }
    try {
        if (state.context.state === 'running') {
            await state.context.suspend();
        }
    } catch (error) {
        logger.warn(`AudioContext suspend failed: ${String(error)}`);
    }
}

function postShutdownToWorklets(master: MasterSection, trackNodes: ReadonlyMap<string, TrackNode>): void {
    const shutdown = { type: 'shutdown' as const };
    const hasWorkletNode = typeof AudioWorkletNode !== 'undefined';
    master.postShutdown(shutdown);
    for (const [, trackNode] of trackNodes) {
        trackNode.strip.meterNode?.port.postMessage(shutdown);
        for (const dn of trackNode.strip.deviceNodes) {
            for (const node of dn.nodes) {
                if (hasWorkletNode && node instanceof AudioWorkletNode) {
                    node.port.postMessage(shutdown);
                }
            }
        }
    }
}

async function disposeOnce(state: LifecycleState, readDisposalEffects: () => Array<() => void>): Promise<void> {
    // Invalidate loadWorklets before a stale continuation can rebuild the disposed graph.
    state.disposed = true;
    state.initializationGeneration++;
    state.initializationCancellation?.reject(new Error('Audio engine was disposed during initialization.'));
    state.initializationCancellation = null;
    state.initPromise = null;
    state.workletReady = false;

    // Keep the synchronous shutdown order, but attempt every independent
    // resource before reporting a fault. Context closure must still settle
    // before the one cached disposal result is returned to any caller.
    await runAllAsyncEffects([() => runAllEffects(readDisposalEffects()), () => state.context.close()]);
}

/**
 * Opens the AudioContext at construction, because its construction time decides
 * its autoplay state, and owns everything that follows from it: the fallback
 * decision, worklet loading, resume and suspend, and disposal.
 */
export function createEngineLifecycle(ports: EngineLifecyclePorts): EngineLifecycle {
    const { readTrackNodes, readDisposalEffects } = ports;
    const latencyProfile = ports.providedContext ? null : readStoredAudioLatencyProfile();
    const latencyHint = latencyProfile === null ? null : getAudioContextLatencyHint(latencyProfile);
    const state: LifecycleState = {
        ...openGraph(ports, latencyHint),
        disposed: false,
        workletReady: false,
        initPromise: null,
        initializationCancellation: null,
        initializationGeneration: 0,
        disposalPromise: null,
        lastInitError: null,
        lastResumeError: null,
    };

    return {
        context: () => state.context,
        replaceContext: (replacement) => {
            state.context = replacement;
        },
        master: () => state.master,
        isFallback: () => state.fallbackMode,
        isDisposed: () => state.disposed,
        assertActive: () => {
            if (state.disposed) {
                throw new Error('Audio engine has been disposed.');
            }
        },
        isWorkletReady: () => state.workletReady,
        lastInitError: () => state.lastInitError,
        lastResumeError: () => state.lastResumeError,
        latencyProfile,
        latencyHint,
        initialize: () => initialize(state),
        resume: () => resume(state),
        suspend: () => suspend(state),
        postShutdownToWorklets: () => postShutdownToWorklets(state.master, readTrackNodes()),
        dispose: () => {
            state.disposalPromise ??= disposeOnce(state, readDisposalEffects);
            return state.disposalPromise;
        },
    };
}
