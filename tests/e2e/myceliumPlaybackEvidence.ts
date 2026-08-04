import { expect, type CDPSession, type Page } from '@playwright/test';

import {
    readRuntimeSnapshot,
    settleWithin,
    type LongTaskWindow,
    type RuntimeSnapshot,
} from './myceliumPerformanceEvidence';

const AUDIO_USE_CASES_PATH = '/src/modules/AudioEngine/useCases/index.ts';
const ARRANGEMENT_USE_CASES_PATH = '/src/modules/Arrangement/useCases/index.ts';
const TRANSPORT_STORES_PATH = '/src/modules/Transport/stores/index.ts';
const TRANSPORT_USE_CASES_PATH = '/src/modules/Transport/useCases/index.ts';
const CUMULATIVE_CDP_METRICS = [
    'LayoutCount',
    'LayoutDuration',
    'RecalcStyleCount',
    'RecalcStyleDuration',
    'ScriptDuration',
    'TaskDuration',
] as const;
const GAUGE_CDP_METRICS = [
    'Documents',
    'Frames',
    'JSEventListeners',
    'JSHeapTotalSize',
    'JSHeapUsedSize',
    'Nodes',
] as const;
const REQUIRED_CDP_METRICS = ['Timestamp', ...CUMULATIVE_CDP_METRICS, ...GAUGE_CDP_METRICS] as const;
const PLAYBACK_STATS_REFRESH_TIMEOUT_MS = 2_500;
const PLAYBACK_STATS_POLL_INTERVAL_MS = 50;
const SIMPLE_CONTROL_DURATION_MS = 5_000;
const SIMPLE_CONTROL_OUTPUT_GAIN = 0.000_01;

export type CdpMetricSample = { elapsedMs: number; values: Record<string, number> };

export type MyceliumPlaybackProgress = {
    phase: 'starting' | 'baseline-ready' | 'playing' | 'endpoint-captured' | 'stopped';
    cdpSamples: CdpMetricSample[];
    longTasks: LongTaskWindow | null;
    playheadSamples: Array<{ elapsedMs: number; beat: number }>;
    startup: {
        playClickElapsedMs: number;
        playingConfirmationElapsedMs: number;
        playheadAdvanceElapsedMs: number;
    } | null;
};

type CaptureMyceliumPlaybackInput = { page: Page; progress: MyceliumPlaybackProgress; smoke: boolean };

type WaitForPlaybackStatsRefreshInput = {
    now?: () => number;
    pollIntervalMs?: number;
    previous: RuntimeSnapshot;
    readSnapshot: () => Promise<RuntimeSnapshot>;
    requiredIsPlaying?: boolean;
    timeoutMs?: number;
    wait: (milliseconds: number) => Promise<void>;
};

export type PlaybackStatsWindow = {
    totalDuration: number;
    underrunDuration: number;
    underrunEvents: number;
    underrunRatio: number;
    underrunEventsPerSecond: number;
    averageUnderrunDuration: number;
    averageLatency: number;
    minimumLatency: number;
    maximumLatency: number;
};

export type SimplePlaybackControl = {
    outcome: 'clean' | 'contaminated';
    wallDurationMs: number;
    realtimeRatio: number;
    playback: PlaybackStatsWindow;
    context: {
        sampleRate: number;
        baseLatency: number;
        outputLatency: number;
        state: AudioContextState;
    };
    environment: {
        userAgent: string;
        visibilityState: DocumentVisibilityState;
    };
};

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must be finite`);
    }
    return value;
}

function field(source: Record<string, unknown>, name: string, label: string): number {
    return finiteNumber(source[name], `${label}.${name}`);
}

function nonnegativeDelta(after: number, before: number, label: string): number {
    const delta = after - before;
    if (delta < 0) {
        throw new Error(`${label} decreased from ${before} to ${after}`);
    }
    return delta;
}

function playback(snapshot: RuntimeSnapshot): Record<string, unknown> {
    return record(record(snapshot.audio, 'Audio diagnostics').playback, 'Audio playback statistics');
}

export function hasPlaybackStatsRefreshed({
    candidate,
    previous,
}: {
    candidate: RuntimeSnapshot;
    previous: RuntimeSnapshot;
}): boolean {
    return (
        field(playback(candidate), 'totalDuration', 'Candidate audio playback statistics') >
        field(playback(previous), 'totalDuration', 'Previous audio playback statistics')
    );
}

function dropouts(snapshot: RuntimeSnapshot): Record<string, unknown> {
    return record(record(snapshot.health, 'Audio health').dropouts, 'Detected dropout statistics');
}

function transport(snapshot: RuntimeSnapshot): Record<string, unknown> {
    return record(snapshot.transport, 'Transport state');
}

function hasRequiredTransportState(snapshot: RuntimeSnapshot, requiredIsPlaying: boolean | undefined): boolean {
    return requiredIsPlaying === undefined || transport(snapshot).isPlaying === requiredIsPlaying;
}

function summarizePlaybackCounters({
    afterPlayback,
    beforePlayback,
}: {
    afterPlayback: Record<string, unknown>;
    beforePlayback: Record<string, unknown>;
}): PlaybackStatsWindow {
    const beforeTotalDuration = field(beforePlayback, 'totalDuration', 'Audio playback statistics');
    const afterTotalDuration = field(afterPlayback, 'totalDuration', 'Audio playback statistics');
    const beforeUnderrunDuration = field(beforePlayback, 'underrunDuration', 'Audio playback statistics');
    const afterUnderrunDuration = field(afterPlayback, 'underrunDuration', 'Audio playback statistics');
    const beforeUnderrunEvents = field(beforePlayback, 'underrunEvents', 'Audio playback statistics');
    const afterUnderrunEvents = field(afterPlayback, 'underrunEvents', 'Audio playback statistics');
    if (
        beforeTotalDuration < 0 ||
        afterTotalDuration < 0 ||
        beforeUnderrunDuration < 0 ||
        afterUnderrunDuration < 0 ||
        beforeUnderrunEvents < 0 ||
        afterUnderrunEvents < 0
    ) {
        throw new Error('Audio playback cumulative counters must be nonnegative');
    }
    if (!Number.isInteger(beforeUnderrunEvents) || !Number.isInteger(afterUnderrunEvents)) {
        throw new TypeError('Audio playback underrunEvents must be integers');
    }
    const totalDuration = nonnegativeDelta(afterTotalDuration, beforeTotalDuration, 'Audio playback totalDuration');
    if (totalDuration <= 0) {
        throw new Error('Audio playback window must have positive totalDuration');
    }
    const underrunDuration = nonnegativeDelta(
        afterUnderrunDuration,
        beforeUnderrunDuration,
        'Audio playback underrunDuration'
    );
    const underrunEvents = nonnegativeDelta(afterUnderrunEvents, beforeUnderrunEvents, 'Audio playback underrunEvents');
    if (underrunDuration > totalDuration) {
        throw new Error('Audio playback underrunDuration cannot exceed totalDuration');
    }
    const averageLatency = field(afterPlayback, 'averageLatency', 'Audio playback statistics');
    const minimumLatency = field(afterPlayback, 'minimumLatency', 'Audio playback statistics');
    const maximumLatency = field(afterPlayback, 'maximumLatency', 'Audio playback statistics');
    if (
        minimumLatency < 0 ||
        maximumLatency < minimumLatency ||
        averageLatency < minimumLatency ||
        averageLatency > maximumLatency
    ) {
        throw new Error('Audio playback latency statistics are inconsistent');
    }
    return {
        totalDuration,
        underrunDuration,
        underrunEvents,
        underrunRatio: underrunDuration / totalDuration,
        underrunEventsPerSecond: underrunEvents / totalDuration,
        averageUnderrunDuration: underrunEvents === 0 ? 0 : underrunDuration / underrunEvents,
        averageLatency,
        minimumLatency,
        maximumLatency,
    };
}

export function summarizePlaybackStatsWindow({
    after,
    before,
}: {
    after: RuntimeSnapshot;
    before: RuntimeSnapshot;
}): PlaybackStatsWindow {
    return summarizePlaybackCounters({ afterPlayback: playback(after), beforePlayback: playback(before) });
}

export function summarizePlaybackHealthWindow({ after, before }: { after: RuntimeSnapshot; before: RuntimeSnapshot }) {
    const beforeDropouts = dropouts(before);
    const afterDropouts = dropouts(after);
    return {
        playback: summarizePlaybackStatsWindow({ after, before }),
        detectedDropouts: {
            detectedUnderrunBlocks: nonnegativeDelta(
                field(afterDropouts, 'detectedUnderrunBlocks', 'Detected dropout statistics'),
                field(beforeDropouts, 'detectedUnderrunBlocks', 'Detected dropout statistics'),
                'Detected dropout blocks'
            ),
            silentFrames: nonnegativeDelta(
                field(afterDropouts, 'silentFrames', 'Detected dropout statistics'),
                field(beforeDropouts, 'silentFrames', 'Detected dropout statistics'),
                'Detected dropout silent frames'
            ),
            lastUnderrunAtFrameBefore: field(beforeDropouts, 'lastUnderrunAtFrame', 'Detected dropout statistics'),
            lastUnderrunAtFrameAfter: field(afterDropouts, 'lastUnderrunAtFrame', 'Detected dropout statistics'),
        },
    };
}

export function summarizeRuntimeWindow({ after, before }: { after: RuntimeSnapshot; before: RuntimeSnapshot }) {
    const scheduler = record(after.scheduler, 'Scheduler diagnostics');
    if (field(scheduler, 'messagesReceived', 'Scheduler diagnostics') <= 0) {
        throw new Error('Playback window received no scheduler messages');
    }
    if (field(scheduler, 'ticksSettled', 'Scheduler diagnostics') <= 0) {
        throw new Error('Playback window settled no scheduler ticks');
    }
    return { ...summarizePlaybackHealthWindow({ after, before }), scheduler };
}

async function readCanonicalTailHorizonSeconds(page: Page): Promise<number> {
    const seconds = await page.evaluate(
        async ({ arrangementPath, audioPath }): Promise<number> => {
            const arrangementModule: unknown = await import(arrangementPath);
            const audioModule: unknown = await import(audioPath);
            if (
                typeof arrangementModule !== 'object' ||
                arrangementModule === null ||
                typeof audioModule !== 'object' ||
                audioModule === null
            ) {
                throw new TypeError('Tail-horizon contracts are unavailable');
            }
            const getPluginById: unknown = Reflect.get(arrangementModule, 'getPluginById');
            const getAutoDetectedTailSeconds: unknown = Reflect.get(audioModule, 'getAutoDetectedTailSeconds');
            if (typeof getPluginById !== 'function' || typeof getAutoDetectedTailSeconds !== 'function') {
                throw new TypeError('Tail-horizon contracts are not callable');
            }
            const detected: unknown = Reflect.apply(getAutoDetectedTailSeconds, undefined, [
                {
                    honorMuted: true,
                    tailForDeviceType: (deviceType: string): unknown => {
                        const descriptor: unknown = Reflect.apply(getPluginById, undefined, [deviceType]);
                        if (typeof descriptor !== 'object' || descriptor === null) {
                            return undefined;
                        }
                        return Reflect.get(descriptor, 'tail');
                    },
                },
            ]);
            if (typeof detected !== 'object' || detected === null) {
                throw new TypeError('Tail-horizon result is invalid');
            }
            const detectedSeconds: unknown = Reflect.get(detected, 'seconds');
            if (typeof detectedSeconds !== 'number' || !Number.isFinite(detectedSeconds)) {
                throw new TypeError('Tail-horizon seconds must be finite');
            }
            return detectedSeconds;
        },
        { arrangementPath: ARRANGEMENT_USE_CASES_PATH, audioPath: AUDIO_USE_CASES_PATH }
    );
    const horizonSeconds = finiteNumber(seconds, 'Canonical tail horizon');
    if (horizonSeconds < 0) {
        throw new Error('Canonical tail horizon cannot be negative');
    }
    return horizonSeconds;
}

export function summarizeCdpMetrics(samples: CdpMetricSample[]) {
    if (samples.length < 2) {
        throw new Error('Playback metrics require a baseline and final sample');
    }
    const baselineSample = samples.at(0);
    if (!baselineSample) {
        throw new Error('Playback metrics have no baseline sample');
    }
    const baseline = baselineSample.values;
    const final = samples.at(-1)?.values;
    if (!final) {
        throw new Error('Playback metrics have no final sample');
    }
    const cumulativeDeltas: Record<string, number> = {};
    for (const name of CUMULATIVE_CDP_METRICS) {
        const baselineValue = field(baseline, name, 'Baseline CDP metrics');
        const finalValue = field(final, name, 'Final CDP metrics');
        cumulativeDeltas[name] = nonnegativeDelta(finalValue, baselineValue, `CDP ${name}`);
    }
    const gaugeHighWater: Record<string, number> = {};
    const gaugeBaseline: Record<string, number> = {};
    const gaugeFinal: Record<string, number> = {};
    const gaugeDelta: Record<string, number> = {};
    for (const name of GAUGE_CDP_METRICS) {
        let highWater = Number.NEGATIVE_INFINITY;
        for (const sample of samples) {
            highWater = Math.max(highWater, field(sample.values, name, 'CDP metric sample'));
        }
        const baselineValue = field(baseline, name, 'Baseline CDP metrics');
        const finalValue = field(final, name, 'Final CDP metrics');
        gaugeBaseline[name] = baselineValue;
        gaugeFinal[name] = finalValue;
        gaugeDelta[name] = finalValue - baselineValue;
        gaugeHighWater[name] = highWater;
    }
    return { cumulativeDeltas, gaugeBaseline, gaugeDelta, gaugeFinal, gaugeHighWater };
}

async function readLivePlayhead(page: Page): Promise<number> {
    return page.evaluate(async (modulePath) => {
        const module: unknown = await import(modulePath);
        if (typeof module !== 'object' || module === null) {
            throw new TypeError('Transport store contract is unavailable');
        }
        const playheadPositionRef: unknown = Reflect.get(module, 'playheadPositionRef');
        const current: unknown =
            typeof playheadPositionRef === 'object' && playheadPositionRef !== null
                ? Reflect.get(playheadPositionRef, 'current')
                : null;
        if (typeof current !== 'number' || !Number.isFinite(current)) {
            throw new TypeError('Transport store has no finite live playhead');
        }
        return current;
    }, TRANSPORT_STORES_PATH);
}

async function waitForLivePlayheadAdvance(input: {
    defaultTempo: number;
    fromBeat: number;
    page: Page;
    sampleRate: number;
    toBeat: number;
}): Promise<{ beat: number; expectedDurationMs: number }> {
    for (;;) {
        const playbackStart = await input.page.evaluate(
            async ({ defaultTempo, fromBeat, modulePath, sampleRate, storesPath, toBeat }) => {
                const stores: unknown = await import(storesPath);
                if (typeof stores !== 'object' || stores === null) {
                    throw new TypeError('Transport store contracts are unavailable');
                }
                const playheadPositionRef: unknown = Reflect.get(stores, 'playheadPositionRef');
                const beat: unknown =
                    typeof playheadPositionRef === 'object' && playheadPositionRef !== null
                        ? Reflect.get(playheadPositionRef, 'current')
                        : null;
                if (typeof beat !== 'number' || !Number.isFinite(beat)) {
                    throw new TypeError('Transport store has no finite live playhead');
                }
                if (beat <= fromBeat) {
                    return { beat, expectedDurationMs: null };
                }

                const useCases: unknown = await import(modulePath);
                if (typeof useCases !== 'object' || useCases === null) {
                    throw new TypeError('Tempo projection contract is unavailable');
                }
                const projectPpqEndpoints: unknown = Reflect.get(useCases, 'projectPpqEndpoints');
                const tempoMapStore: unknown = Reflect.get(stores, 'tempoMapStore');
                const tempoMap: unknown =
                    typeof tempoMapStore === 'object' && tempoMapStore !== null
                        ? Reflect.get(tempoMapStore, 'value')
                        : null;
                const changes: unknown =
                    typeof tempoMap === 'object' && tempoMap !== null ? Reflect.get(tempoMap, 'changes') : null;
                if (typeof projectPpqEndpoints !== 'function' || !Array.isArray(changes)) {
                    throw new TypeError('Tempo projection contracts are invalid');
                }
                const projectedEndpoints: unknown = Reflect.apply(projectPpqEndpoints, undefined, [
                    { startPpq: fromBeat, endPpq: toBeat, defaultTempo, sampleRate, changes },
                ]);
                const durationSeconds: unknown =
                    typeof projectedEndpoints === 'object' && projectedEndpoints !== null
                        ? Reflect.get(projectedEndpoints, 'durationSeconds')
                        : null;
                if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
                    throw new TypeError('Tempo projection returned no positive duration');
                }
                return { beat, expectedDurationMs: durationSeconds * 1_000 };
            },
            {
                defaultTempo: input.defaultTempo,
                fromBeat: input.fromBeat,
                modulePath: TRANSPORT_USE_CASES_PATH,
                sampleRate: input.sampleRate,
                storesPath: TRANSPORT_STORES_PATH,
                toBeat: input.toBeat,
            }
        );
        if (playbackStart.expectedDurationMs !== null) {
            return playbackStart;
        }
        await input.page.waitForTimeout(100);
    }
}

async function readCdpMetrics(session: CDPSession, startedAtMs: number): Promise<CdpMetricSample> {
    const response = await session.send('Performance.getMetrics');
    const values: Record<string, number> = {};
    for (const metric of response.metrics) {
        values[metric.name] = metric.value;
    }
    for (const name of REQUIRED_CDP_METRICS) {
        finiteNumber(values[name], `CDP ${name}`);
    }
    return { elapsedMs: performance.now() - startedAtMs, values };
}

async function resetPlaybackLatencyWindow(page: Page): Promise<void> {
    await page.evaluate(async (modulePath) => {
        const module: unknown = await import(modulePath);
        const reset: unknown =
            typeof module === 'object' && module !== null
                ? Reflect.get(module, 'resetEnginePlaybackLatencyStats')
                : null;
        if (typeof reset !== 'function') {
            throw new TypeError('AudioEngine contract has no playback latency reset');
        }
        Reflect.apply(reset, undefined, []);
    }, AUDIO_USE_CASES_PATH);
}

export async function waitForPlaybackStatsRefresh({
    now = () => performance.now(),
    pollIntervalMs = PLAYBACK_STATS_POLL_INTERVAL_MS,
    previous,
    readSnapshot,
    requiredIsPlaying,
    timeoutMs = PLAYBACK_STATS_REFRESH_TIMEOUT_MS,
    wait,
}: WaitForPlaybackStatsRefreshInput): Promise<RuntimeSnapshot> {
    const deadlineAtMs = now() + timeoutMs;
    while (now() < deadlineAtMs) {
        await wait(pollIntervalMs);
        const remainingMs = Math.max(1, Math.ceil(deadlineAtMs - now()));
        const candidate = await settleWithin(readSnapshot(), remainingMs, 'Playback statistics refresh');
        if (
            hasPlaybackStatsRefreshed({ candidate, previous }) &&
            hasRequiredTransportState(candidate, requiredIsPlaying)
        ) {
            return candidate;
        }
    }
    throw new Error('Chrome playback statistics did not publish a fresh snapshot');
}

async function refreshPagePlaybackStats(
    page: Page,
    previous: RuntimeSnapshot,
    requiredIsPlaying: boolean
): Promise<RuntimeSnapshot> {
    return waitForPlaybackStatsRefresh({
        previous,
        readSnapshot: () => readRuntimeSnapshot(page),
        requiredIsPlaying,
        wait: (milliseconds) => page.waitForTimeout(milliseconds),
    });
}

export function classifySimplePlaybackControl({
    playbackWindow,
    realtimeRatio,
    visibilityState,
}: {
    playbackWindow: PlaybackStatsWindow;
    realtimeRatio: number;
    visibilityState: DocumentVisibilityState;
}): SimplePlaybackControl['outcome'] {
    finiteNumber(realtimeRatio, 'Simple control realtime ratio');
    if (
        playbackWindow.underrunEvents === 0 &&
        playbackWindow.underrunDuration === 0 &&
        realtimeRatio >= 0.9 &&
        realtimeRatio <= 1.1 &&
        visibilityState === 'visible'
    ) {
        return 'clean';
    }
    return 'contaminated';
}

export async function captureSimplePlaybackControl(
    page: Page,
    durationMs = SIMPLE_CONTROL_DURATION_MS
): Promise<SimplePlaybackControl> {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new TypeError('Simple control duration must be positive and finite');
    }
    const raw = await page.evaluate(
        async ({ controlDurationMs, modulePath, outputGain, pollIntervalMs, refreshTimeoutMs }) => {
            type PlaybackStats = {
                totalDuration: number;
                underrunDuration: number;
                underrunEvents: number;
                averageLatency: number;
                minimumLatency: number;
                maximumLatency: number;
            };
            const module: unknown = await import(modulePath);
            const getAudioContext: unknown =
                typeof module === 'object' && module !== null ? Reflect.get(module, 'getAudioContext') : null;
            if (typeof getAudioContext !== 'function') {
                throw new TypeError('AudioEngine contract has no canonical AudioContext accessor');
            }
            const context: unknown = Reflect.apply(getAudioContext, undefined, []);
            if (!(context instanceof AudioContext)) {
                throw new TypeError('AudioEngine contract returned no AudioContext');
            }
            const finite = (value: unknown, label: string): number => {
                if (typeof value !== 'number' || !Number.isFinite(value)) {
                    throw new TypeError(`${label} must be finite`);
                }
                return value;
            };
            const readPlaybackStats = (): PlaybackStats => {
                const value: unknown = Reflect.get(context, 'playbackStats');
                if (typeof value !== 'object' || value === null) {
                    throw new TypeError('Simple control requires AudioContext.playbackStats');
                }
                return {
                    totalDuration: finite(Reflect.get(value, 'totalDuration'), 'playbackStats.totalDuration'),
                    underrunDuration: finite(Reflect.get(value, 'underrunDuration'), 'playbackStats.underrunDuration'),
                    underrunEvents: finite(Reflect.get(value, 'underrunEvents'), 'playbackStats.underrunEvents'),
                    averageLatency: finite(Reflect.get(value, 'averageLatency'), 'playbackStats.averageLatency'),
                    minimumLatency: finite(Reflect.get(value, 'minimumLatency'), 'playbackStats.minimumLatency'),
                    maximumLatency: finite(Reflect.get(value, 'maximumLatency'), 'playbackStats.maximumLatency'),
                };
            };
            const wait = (milliseconds: number): Promise<void> =>
                new Promise((resolve) => {
                    setTimeout(resolve, milliseconds);
                });
            const waitForFreshStats = async (previous: PlaybackStats): Promise<PlaybackStats> => {
                const deadlineAtMs = performance.now() + refreshTimeoutMs;
                while (performance.now() < deadlineAtMs) {
                    await wait(pollIntervalMs);
                    const candidate = readPlaybackStats();
                    if (candidate.totalDuration > previous.totalDuration) {
                        return candidate;
                    }
                }
                throw new Error('Simple control playback statistics did not publish a fresh snapshot');
            };

            let oscillator: OscillatorNode | null = null;
            let gain: GainNode | null = null;
            let oscillatorStarted = false;
            try {
                oscillator = context.createOscillator();
                gain = context.createGain();
                oscillator.connect(gain).connect(context.destination);
                // Keep the branch observable to Chrome's audio renderer while making
                // the control tone effectively inaudible (-100 dBFS).
                gain.gain.value = outputGain;
                oscillator.start();
                oscillatorStarted = true;
                await context.resume();
                if (context.state !== 'running') {
                    throw new Error(`Simple control AudioContext remained ${context.state}`);
                }
                const before = await waitForFreshStats(readPlaybackStats());
                const startedAtMs = performance.now();
                await wait(controlDurationMs);
                const after = await waitForFreshStats(readPlaybackStats());
                return {
                    before,
                    after,
                    wallDurationMs: performance.now() - startedAtMs,
                    context: {
                        sampleRate: context.sampleRate,
                        baseLatency: context.baseLatency,
                        outputLatency: context.outputLatency,
                        state: context.state,
                    },
                    environment: {
                        userAgent: navigator.userAgent,
                        visibilityState: document.visibilityState,
                    },
                };
            } finally {
                if (oscillatorStarted) {
                    oscillator?.stop();
                }
                oscillator?.disconnect();
                gain?.disconnect();
            }
        },
        {
            controlDurationMs: durationMs,
            modulePath: AUDIO_USE_CASES_PATH,
            outputGain: SIMPLE_CONTROL_OUTPUT_GAIN,
            pollIntervalMs: PLAYBACK_STATS_POLL_INTERVAL_MS,
            refreshTimeoutMs: PLAYBACK_STATS_REFRESH_TIMEOUT_MS,
        }
    );
    const playbackWindow = summarizePlaybackCounters({
        afterPlayback: record(raw.after, 'Simple control endpoint'),
        beforePlayback: record(raw.before, 'Simple control baseline'),
    });
    const wallDurationMs = finiteNumber(raw.wallDurationMs, 'Simple control wall duration');
    if (wallDurationMs <= 0) {
        throw new Error('Simple control wall duration must be positive');
    }
    const context = record(raw.context, 'Simple control AudioContext');
    const sampleRate = field(context, 'sampleRate', 'Simple control AudioContext');
    const baseLatency = field(context, 'baseLatency', 'Simple control AudioContext');
    const outputLatency = field(context, 'outputLatency', 'Simple control AudioContext');
    if (sampleRate <= 0 || baseLatency < 0 || outputLatency < 0 || context.state !== 'running') {
        throw new Error('Simple control AudioContext evidence is invalid');
    }
    const environment = record(raw.environment, 'Simple control environment');
    const userAgent = environment.userAgent;
    const visibilityState = environment.visibilityState;
    if (typeof userAgent !== 'string' || userAgent.length === 0) {
        throw new TypeError('Simple control user agent must be a non-empty string');
    }
    if (visibilityState !== 'visible' && visibilityState !== 'hidden') {
        throw new TypeError('Simple control visibility state is invalid');
    }
    const realtimeRatio = (playbackWindow.totalDuration * 1_000) / wallDurationMs;
    return {
        outcome: classifySimplePlaybackControl({ playbackWindow, realtimeRatio, visibilityState }),
        wallDurationMs,
        realtimeRatio,
        playback: playbackWindow,
        context: { sampleRate, baseLatency, outputLatency, state: 'running' },
        environment: { userAgent, visibilityState },
    };
}

export async function captureMyceliumPlayback({ page, progress, smoke }: CaptureMyceliumPlaybackInput) {
    const samples = progress.cdpSamples;
    const playheadSamples = progress.playheadSamples;
    let cdp: CDPSession | null = null;
    let playbackStarted = false;
    try {
        const initial = await settleWithin(readRuntimeSnapshot(page), 5_000, 'Initial playback runtime snapshot');
        const initialTransport = transport(initial);
        const loopStart = field(initialTransport, 'loopStart', 'Transport state');
        const loopEnd = field(initialTransport, 'loopEnd', 'Transport state');
        if (initialTransport.isLooping !== true || loopStart !== 0 || loopEnd !== 576) {
            throw new Error(`Canonical Mycelium loop must remain enabled at 0..576; received ${loopStart}..${loopEnd}`);
        }
        const audioContext = record(record(initial.audio, 'Audio diagnostics').context, 'Audio context diagnostics');
        const tailHorizonSeconds = await settleWithin(
            readCanonicalTailHorizonSeconds(page),
            5_000,
            'Canonical Mycelium tail horizon'
        );
        cdp = await settleWithin(page.context().newCDPSession(page), 5_000, 'Create playback CDP session');
        await settleWithin(cdp.send('Performance.enable'), 5_000, 'Enable CDP performance metrics');
        const prePlayPosition = await settleWithin(readLivePlayhead(page), 5_000, 'Pre-play live position');
        if (prePlayPosition !== loopStart) {
            throw new Error(`Mycelium playback must start at loop beat ${loopStart}; received ${prePlayPosition}`);
        }
        const staleBeforePlay = await settleWithin(readRuntimeSnapshot(page), 5_000, 'Stale pre-play runtime baseline');
        const beforePlay = await settleWithin(
            refreshPagePlaybackStats(page, staleBeforePlay, false),
            5_000,
            'Fresh pre-play playback statistics baseline'
        );
        await settleWithin(resetPlaybackLatencyWindow(page), 5_000, 'Reset playback latency window');
        const measurementStartedAtMs = performance.now();
        samples.push(await settleWithin(readCdpMetrics(cdp, measurementStartedAtMs), 5_000, 'Baseline CDP sample'));
        playheadSamples.push({ elapsedMs: 0, beat: prePlayPosition });
        progress.phase = 'baseline-ready';
        const playClickStartedAtMs = performance.now();
        await page.getByRole('button', { name: 'Play', exact: true }).click({ timeout: 12_000 });
        const playClickElapsedMs = performance.now() - playClickStartedAtMs;
        playbackStarted = true;
        const playing = await settleWithin(readRuntimeSnapshot(page), 12_000, 'Transport playing confirmation');
        const playingConfirmationElapsedMs = performance.now() - playClickStartedAtMs;
        expect(transport(playing).isPlaying).toBe(true);
        const playbackStart = await settleWithin(
            waitForLivePlayheadAdvance({
                defaultTempo: field(initialTransport, 'tempo', 'Transport state'),
                fromBeat: prePlayPosition,
                page,
                sampleRate: field(audioContext, 'sampleRate', 'Audio context diagnostics'),
                toBeat: loopEnd,
            }),
            12_000,
            'Live playback advance confirmation'
        );
        const playheadAdvanceElapsedMs = performance.now() - playClickStartedAtMs;
        progress.startup = { playClickElapsedMs, playingConfirmationElapsedMs, playheadAdvanceElapsedMs };
        const expectedDurationMs = playbackStart.expectedDurationMs;
        const playbackStartedAtMs = playClickStartedAtMs;
        progress.phase = 'playing';
        const startupEndpoint = await settleWithin(
            refreshPagePlaybackStats(page, beforePlay, true),
            5_000,
            'Fresh startup playback statistics endpoint'
        );
        const startupPlayhead = await settleWithin(readLivePlayhead(page), 5_000, 'Startup live playback position');
        playheadSamples.push({ elapsedMs: performance.now() - playbackStartedAtMs, beat: startupPlayhead });
        const smokeLimitMs = 10_000;
        const safetyLimitMs = expectedDurationMs * 1.2 + 30_000;
        let previousBeat = startupPlayhead;
        let outcome: 'loop-complete' | 'safety-limit' | null = null;
        while (outcome === null) {
            await page.waitForTimeout(smoke ? 1_000 : 2_500);
            samples.push(await settleWithin(readCdpMetrics(cdp, measurementStartedAtMs), 5_000, 'CDP playback sample'));
            const currentBeat = await settleWithin(readLivePlayhead(page), 5_000, 'Live playback position');
            const elapsedMs = performance.now() - playbackStartedAtMs;
            playheadSamples.push({ elapsedMs, beat: currentBeat });
            if (smoke && elapsedMs >= smokeLimitMs) {
                outcome = 'safety-limit';
            } else if (!smoke && currentBeat < previousBeat) {
                outcome = 'loop-complete';
            } else if (!smoke && elapsedMs >= safetyLimitMs) {
                throw new Error(`Mycelium playback exceeded its ${Math.round(safetyLimitMs)}ms safety limit`);
            }
            previousBeat = currentBeat;
        }
        const playbackElapsedMs = performance.now() - playbackStartedAtMs;
        if (!smoke && playbackElapsedMs < expectedDurationMs - 5_000) {
            throw new Error('Mycelium loop wrapped before its tempo-map duration elapsed');
        }
        await page.getByRole('button', { name: 'Stop', exact: true }).click({ timeout: 12_000 });
        const stopRequestedAtMs = performance.now();
        const stopRequested = await settleWithin(readRuntimeSnapshot(page), 5_000, 'Stop-request runtime snapshot');
        const stopBoundaryRefreshStartedAtMs = performance.now();
        const stopped = await settleWithin(
            refreshPagePlaybackStats(page, stopRequested, false),
            5_000,
            'Fresh stopped playback statistics endpoint'
        );
        const stopBoundaryRefreshElapsedMs = performance.now() - stopBoundaryRefreshStartedAtMs;
        const runtimeWindowElapsedMs = performance.now() - measurementStartedAtMs;
        samples.push(await settleWithin(readCdpMetrics(cdp, measurementStartedAtMs), 5_000, 'Final CDP sample'));
        progress.phase = 'endpoint-captured';
        const postStopRefreshStartedAtMs = performance.now();
        const postStop = await settleWithin(
            refreshPagePlaybackStats(page, stopped, false),
            5_000,
            'Fresh post-stop playback statistics'
        );
        const postStopRefreshElapsedMs = performance.now() - postStopRefreshStartedAtMs;
        expect(transport(postStop).isPlaying).toBe(false);
        playbackStarted = false;
        progress.phase = 'stopped';
        const tailDeadlineAtMs = stopRequestedAtMs + tailHorizonSeconds * 1_000;
        const remainingTailMs = Math.max(0, tailDeadlineAtMs - performance.now());
        if (remainingTailMs > 0) {
            await page.waitForTimeout(remainingTailMs);
        }
        const staleTailEndpoint = await settleWithin(readRuntimeSnapshot(page), 5_000, 'Stale tail endpoint');
        const tailEndpoint = await settleWithin(
            refreshPagePlaybackStats(page, staleTailEndpoint, false),
            5_000,
            'Fresh tail playback statistics endpoint'
        );
        const tailDrainElapsedMs = performance.now() - stopRequestedAtMs;
        expect(transport(tailEndpoint).isPlaying).toBe(false);
        const finalTransport = transport(tailEndpoint);
        if (
            finalTransport.isLooping !== true ||
            field(finalTransport, 'loopStart', 'Transport state') !== loopStart ||
            field(finalTransport, 'loopEnd', 'Transport state') !== loopEnd
        ) {
            throw new Error('Playback measurement changed the canonical loop configuration');
        }
        const summary = summarizeRuntimeWindow({ after: stopped, before: beforePlay });
        const realtimeRatio = (summary.playback.totalDuration * 1_000) / runtimeWindowElapsedMs;
        const tempoMapDurationRatio = playbackElapsedMs / expectedDurationMs;
        return {
            cdp: { samples, summary: summarizeCdpMetrics(samples) },
            expectedDurationMs,
            outcome,
            playbackElapsedMs,
            playheadSamples,
            stopBoundaryRefreshElapsedMs,
            postStopRefreshElapsedMs,
            realtimeRatio,
            tailDrainElapsedMs,
            tailHorizonSeconds,
            tempoMapDurationRatio,
            runtimeWindowElapsedMs,
            runtime: {
                after: stopped,
                before: beforePlay,
                startupEndpoint,
                stopRequested,
                stopped,
                postStop,
                tailEndpoint,
                summary,
                startupPlayback: summarizePlaybackStatsWindow({ after: startupEndpoint, before: beforePlay }),
                bodyPlayback: summarizePlaybackStatsWindow({ after: stopRequested, before: startupEndpoint }),
                stopBoundaryPlayback: summarizePlaybackStatsWindow({ after: stopped, before: stopRequested }),
                postStopPlayback: summarizePlaybackStatsWindow({ after: postStop, before: stopped }),
                tailSummary: summarizePlaybackHealthWindow({ after: tailEndpoint, before: stopped }),
                fullPlaybackHealth: summarizePlaybackHealthWindow({ after: tailEndpoint, before: beforePlay }),
            },
        };
    } finally {
        if (playbackStarted && !page.isClosed()) {
            await page
                .getByRole('button', { name: 'Stop', exact: true })
                .click({ timeout: 5_000 })
                .catch(() => undefined);
        }
        if (cdp) {
            await settleWithin(cdp.detach(), 5_000, 'Detach playback CDP session').catch(() => undefined);
        }
    }
}
