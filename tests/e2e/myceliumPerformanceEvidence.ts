import { chromium, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const AUDIO_USE_CASES_PATH = '/src/modules/AudioEngine/useCases/index.ts';
const ARRANGEMENT_STORES_PATH = '/src/modules/Arrangement/stores/index.ts';
const PROJECT_STORES_PATH = '/src/modules/Project/stores/index.ts';
const PROJECT_USE_CASES_PATH = '/src/modules/Project/useCases/index.ts';
const TRANSPORT_STORES_PATH = '/src/modules/Transport/stores/index.ts';
const TRANSPORT_USE_CASES_PATH = '/src/modules/Transport/useCases/index.ts';
const LONG_TASK_LIMIT = 20;
const LONG_TASK_WINDOW_KEY = '__sourdawMyceliumLongTaskWindow';
const MYCELIUM_TEMPLATE_ID = 'demo-mycelium-ascendant';

type RuntimeCapabilities = {
    crossOriginIsolated: boolean;
    hasLongTasks: boolean;
    hasMeasureMemory: boolean;
    userAgent: string;
};

export type RuntimeSnapshot = {
    capturedAtMs: number;
    audio: unknown;
    health: unknown;
    livePlayheadPosition: number;
    projectDirty: boolean | null;
    probeDurationMs: Record<string, number>;
    readiness: unknown;
    scheduler: unknown;
    transport: unknown;
    visibilityState: DocumentVisibilityState;
};

export type PlayableDeviceWait = {
    outcome: 'ready' | 'failed' | 'timeout';
    elapsedMs: number;
    expectedAudioDeviceCount: number;
    readinessGeneration: number;
    snapshot: RuntimeSnapshot;
};

type PlayableDeviceWaitInput = {
    page: Page;
    successorOfGeneration?: number;
    timeoutMs?: number;
};

type ReadPageMemoryInput = {
    label: string;
    page: Page;
};

type RejectOnPageErrorDuringInput<T> = {
    abort: () => Promise<void>;
    captureBeforeAbort?: (error: unknown) => Promise<void>;
    label: string;
    operation: () => Promise<T>;
    page: {
        off: (event: 'pageerror', listener: (error: Error) => void) => void;
        on: (event: 'pageerror', listener: (error: Error) => void) => void;
    };
    pageError?: Promise<never>;
    timeoutMs: number;
};

type CloseMeasuredBrowserInput = {
    browser: Pick<Browser, 'close' | 'isConnected'>;
    timeoutMs?: number;
};

export type PageMemoryCheckpoint = {
    bytes: number;
    capturedAtMs: number;
    result: unknown;
};

export type LongTaskWindow = {
    count: number;
    endedAtMs: number;
    maxDurationMs: number;
    startedAtMs: number;
    totalDurationMs: number;
    worst: Array<{ durationMs: number; name: string; startTimeMs: number }>;
};

type PerformanceMetadata = {
    gitSha: string;
    gitDirty: boolean;
    harnessGitSha: string;
    harnessGitDirty: boolean;
    headless: boolean;
    smoke: boolean;
    audioLatencyProfile: 'lowLatency' | 'highCapacity';
    os: MyceliumEvidenceEnvironment['os'];
};

export type MyceliumEvidenceEnvironment = {
    gitSha: string;
    gitDirty: boolean;
    harnessGitSha: string;
    harnessGitDirty: boolean;
    browserVersion: string;
    os: {
        platform: string;
        release: string;
        architecture: string;
        cpuModel: string;
        logicalCpuCount: number;
        totalMemoryBytes: number;
        freeMemoryBytesAtStart: number;
    };
    viewport: { width: number; height: number };
    headless: boolean;
    smoke: boolean;
    audioLatencyProfile: 'lowLatency' | 'highCapacity';
    audioContext: {
        latencyProfile: 'lowLatency' | 'highCapacity';
        latencyHint: 'interactive' | 'playback';
        sampleRate: number;
        baseLatency: number;
        outputLatency: number;
    };
    repeatIndex: number;
    capabilities: RuntimeCapabilities;
};

type OpenMeasuredPageOutput = {
    abort: () => Promise<void>;
    close: () => Promise<void>;
    page: Page;
    pageError: Promise<never>;
    environment: MyceliumEvidenceEnvironment;
};

type CaptureFailureEvidenceInput = {
    testInfo: TestInfo;
    page: Page | null;
    environment: unknown;
    error: unknown;
    partial?: unknown;
};

function getBaseUrl(testInfo: TestInfo): string {
    const baseUrl = testInfo.project.use.baseURL;
    if (typeof baseUrl !== 'string') {
        throw new TypeError('Mycelium performance evidence requires a configured Playwright baseURL');
    }
    return baseUrl;
}

function getRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function getNumber(record: Record<string, unknown>, name: string, label: string): number {
    const value = record[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must expose a finite ${name}`);
    }
    return value;
}

function getReadinessGeneration(readiness: Record<string, unknown>): number {
    const generation = getNumber(readiness, 'generation', 'Device readiness snapshot');
    if (!Number.isSafeInteger(generation) || generation < 0) {
        throw new TypeError('Device readiness generation must be a non-negative safe integer');
    }
    return generation;
}

export async function settleWithin<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)), timeoutMs);
    });
    try {
        return await Promise.race([operation, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

function settleBefore<T>(operation: Promise<T>, deadlineAtMs: number, label: string): Promise<T> {
    const remainingMs = Math.max(1, Math.ceil(deadlineAtMs - performance.now()));
    return settleWithin(operation, remainingMs, label);
}

export async function closeMeasuredBrowser({ browser, timeoutMs = 10_000 }: CloseMeasuredBrowserInput): Promise<void> {
    try {
        await settleWithin(browser.close(), timeoutMs, 'Stable Chrome shutdown');
    } catch (error) {
        if (!browser.isConnected()) {
            return;
        }
        throw error;
    }
}

export function createMeasuredBrowserCloser(input: CloseMeasuredBrowserInput): () => Promise<void> {
    let closing: Promise<void> | null = null;
    return () => {
        if (closing === null) {
            const attempt = closeMeasuredBrowser(input);
            closing = attempt;
            void attempt.catch(() => {
                if (input.browser.isConnected() && closing === attempt) {
                    closing = null;
                }
            });
        }
        return closing;
    };
}

function readPerformanceMetadata(testInfo: TestInfo): PerformanceMetadata {
    const metadata = getRecord(testInfo.project.metadata, 'Playwright project metadata');
    const performanceMetadata = getRecord(metadata.performance, 'Playwright performance metadata');
    const os = getRecord(performanceMetadata.os, 'Playwright OS metadata');
    const gitSha = performanceMetadata.gitSha;
    const gitDirty = performanceMetadata.gitDirty;
    const harnessGitSha = performanceMetadata.harnessGitSha;
    const harnessGitDirty = performanceMetadata.harnessGitDirty;
    const headless = performanceMetadata.headless;
    const smoke = performanceMetadata.smoke;
    const audioLatencyProfile = performanceMetadata.audioLatencyProfile;
    const osValues = {
        platform: os.platform,
        release: os.release,
        architecture: os.architecture,
        cpuModel: os.cpuModel,
        logicalCpuCount: os.logicalCpuCount,
        totalMemoryBytes: os.totalMemoryBytes,
        freeMemoryBytesAtStart: os.freeMemoryBytesAtStart,
    };
    if (
        typeof gitSha !== 'string' ||
        typeof gitDirty !== 'boolean' ||
        typeof harnessGitSha !== 'string' ||
        typeof harnessGitDirty !== 'boolean' ||
        typeof headless !== 'boolean' ||
        typeof smoke !== 'boolean' ||
        (audioLatencyProfile !== 'lowLatency' && audioLatencyProfile !== 'highCapacity') ||
        typeof osValues.platform !== 'string' ||
        typeof osValues.release !== 'string' ||
        typeof osValues.architecture !== 'string' ||
        typeof osValues.cpuModel !== 'string' ||
        typeof osValues.logicalCpuCount !== 'number' ||
        typeof osValues.totalMemoryBytes !== 'number' ||
        typeof osValues.freeMemoryBytesAtStart !== 'number'
    ) {
        throw new TypeError('Playwright performance metadata is incomplete');
    }
    return {
        gitSha,
        gitDirty,
        harnessGitSha,
        harnessGitDirty,
        headless,
        smoke,
        audioLatencyProfile,
        os: osValues as MyceliumEvidenceEnvironment['os'],
    };
}

async function readCapabilities(page: Page): Promise<RuntimeCapabilities> {
    return page.evaluate(() => ({
        crossOriginIsolated: globalThis.crossOriginIsolated,
        hasLongTasks: PerformanceObserver.supportedEntryTypes.includes('longtask'),
        hasMeasureMemory: typeof Reflect.get(performance, 'measureUserAgentSpecificMemory') === 'function',
        userAgent: navigator.userAgent,
    }));
}

export async function openMeasuredPage(testInfo: TestInfo): Promise<OpenMeasuredPageOutput> {
    const metadata = readPerformanceMetadata(testInfo);
    let browser: Browser;
    try {
        browser = await chromium.launch({ channel: 'chrome', headless: metadata.headless, timeout: 30_000 });
    } catch (error) {
        await captureFailureEvidence({ testInfo, page: null, environment: metadata, error }).catch(() => undefined);
        throw error;
    }
    const closeBrowser = createMeasuredBrowserCloser({ browser });
    let closeContext: (() => Promise<void>) | null = null;
    let releasePageErrorMonitor: (() => void) | null = null;
    const cleanup = async (): Promise<void> => {
        const cleanupErrors: unknown[] = [];
        releasePageErrorMonitor?.();
        releasePageErrorMonitor = null;
        if (closeContext) {
            try {
                await closeContext();
            } catch (error) {
                cleanupErrors.push(error);
            }
        }
        try {
            await closeBrowser();
        } catch (error) {
            cleanupErrors.push(error);
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError(cleanupErrors, 'Measured browser cleanup failed');
        }
    };
    let page: Page | null = null;
    let capabilities: RuntimeCapabilities | null = null;
    try {
        const context = await browser.newContext({
            baseURL: getBaseUrl(testInfo),
            viewport: { width: 1920, height: 1080 },
        });
        let contextClose: Promise<void> | null = null;
        closeContext = (): Promise<void> => {
            contextClose ??= settleWithin(context.close(), 10_000, 'Measured browser context shutdown');
            return contextClose;
        };
        page = await context.newPage();
        let rejectPageError: (error: Error) => void = () => undefined;
        const pageError = new Promise<never>((_resolve, reject) => {
            rejectPageError = reject;
        });
        const onPageError = (error: Error): void => rejectPageError(error);
        page.on('pageerror', onPageError);
        releasePageErrorMonitor = () => page?.off('pageerror', onPageError);
        await settleWithin(
            Promise.race([
                setupWorkspace(page, {
                    localStorage: [
                        {
                            name: 'sourdaw-preferences',
                            value: superjsonStringify({
                                preferencesSchemaVersion: 2,
                                audioLatencyProfile: metadata.audioLatencyProfile,
                            }),
                        },
                    ],
                }),
                pageError,
            ]),
            60_000,
            'Measured workspace setup'
        );

        capabilities = await settleWithin(
            Promise.race([readCapabilities(page), pageError]),
            30_000,
            'Runtime capability probe'
        );
        expect(capabilities.crossOriginIsolated).toBe(true);
        expect(capabilities.userAgent).toContain('Chrome/');
        const startupSnapshot = await settleWithin(readRuntimeSnapshot(page), 30_000, 'Audio profile startup probe');
        const startupAudio = getRecord(startupSnapshot.audio, 'Audio diagnostics');
        const startupContext = getRecord(startupAudio.context, 'Audio context diagnostics');
        const startupSampleRate = getNumber(startupContext, 'sampleRate', 'Audio context diagnostics');
        const startupBaseLatency = getNumber(startupContext, 'baseLatency', 'Audio context diagnostics');
        const startupOutputLatency = getNumber(startupContext, 'outputLatency', 'Audio context diagnostics');
        if (startupSampleRate <= 0 || startupBaseLatency < 0 || startupOutputLatency < 0) {
            throw new RangeError('Audio context diagnostics must expose positive sample rate and non-negative latency');
        }
        let expectedLatencyHint: 'interactive' | 'playback' = 'interactive';
        if (metadata.audioLatencyProfile === 'highCapacity') {
            expectedLatencyHint = 'playback';
        }
        const storedStartupProfile = await page.evaluate(() => {
            const rawPreferences = window.localStorage.getItem('sourdaw-preferences');
            if (rawPreferences === null) {
                return null;
            }
            try {
                const envelope = JSON.parse(rawPreferences) as { json?: { audioLatencyProfile?: unknown } };
                return envelope.json?.audioLatencyProfile ?? null;
            } catch {
                return 'invalid-storage-payload';
            }
        });
        if (
            storedStartupProfile !== metadata.audioLatencyProfile ||
            startupContext.latencyProfile !== metadata.audioLatencyProfile ||
            startupContext.latencyHint !== expectedLatencyHint
        ) {
            throw new Error(
                `Audio profile startup mismatch: ${JSON.stringify({
                    requested: metadata.audioLatencyProfile,
                    stored: storedStartupProfile,
                    running: startupContext.latencyProfile,
                    expectedLatencyHint,
                    runningLatencyHint: startupContext.latencyHint,
                })}`
            );
        }

        return {
            abort: cleanup,
            close: cleanup,
            page,
            pageError,
            environment: {
                gitSha: metadata.gitSha,
                gitDirty: metadata.gitDirty,
                harnessGitSha: metadata.harnessGitSha,
                harnessGitDirty: metadata.harnessGitDirty,
                browserVersion: browser.version(),
                os: metadata.os,
                viewport: { width: 1920, height: 1080 },
                headless: metadata.headless,
                smoke: metadata.smoke,
                audioLatencyProfile: metadata.audioLatencyProfile,
                audioContext: {
                    latencyProfile: metadata.audioLatencyProfile,
                    latencyHint: expectedLatencyHint,
                    sampleRate: startupSampleRate,
                    baseLatency: startupBaseLatency,
                    outputLatency: startupOutputLatency,
                },
                repeatIndex: testInfo.repeatEachIndex,
                capabilities,
            },
        };
    } catch (error) {
        await captureFailureEvidence({
            testInfo,
            page,
            environment: { ...metadata, browserVersion: browser.version(), capabilities },
            error,
        }).catch(() => undefined);
        try {
            await cleanup();
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Measured page setup and cleanup failed');
        }
        throw error;
    }
}

export async function launchMycelium(page: Page): Promise<void> {
    const deadlineAtMs = performance.now() + 120_000;
    const actionTimeoutMs = (): number => Math.min(30_000, Math.max(1, Math.ceil(deadlineAtMs - performance.now())));
    await page.locator('#launch-demo-project').click({ timeout: actionTimeoutMs() });
    const card = page.getByRole('button', { name: /Mycelium Ascendant/i });
    await expect(card).toBeVisible({ timeout: actionTimeoutMs() });
    await card.click({ timeout: actionTimeoutMs() });
    await settleBefore(wait_for_workspace_ready(page), deadlineAtMs, 'Mycelium workspace launch');
}

async function waitForTransportPlaying(page: Page, expected: boolean): Promise<void> {
    await expect
        .poll(
            async () => {
                const snapshot = await readRuntimeSnapshot(page);
                const transport = getRecord(snapshot.transport, 'Transport state');
                return transport.isPlaying;
            },
            { timeout: 12_000 }
        )
        .toBe(expected);
}

const WARM_PLAYBACK_BEFORE_REPLACEMENT_MS = 30_000;
const WARM_PLAYBACK_SAMPLE_INTERVAL_MS = 5_000;
const WARM_MINIMUM_REALTIME_RATIO = 0.8;
const WARM_SCHEDULER_LOOKAHEAD_MS = 100;

type WarmPlaybackBeforeReplacementInput = {
    expectedAudioDeviceCount: number;
    onSnapshot?: (snapshot: RuntimeSnapshot) => void;
    readSnapshot: () => Promise<RuntimeSnapshot>;
    wait: (durationMs: number) => Promise<void>;
};

function assertWarmCounterStable({
    baseline,
    current,
    label,
    requireCleanBaseline = true,
}: {
    baseline: number;
    current: number;
    label: string;
    requireCleanBaseline?: boolean;
}): void {
    if (requireCleanBaseline && baseline !== 0) {
        throw new Error(`Warm playback baseline already contained ${label}: ${baseline}`);
    }
    if (current < baseline) {
        throw new Error(`Warm playback ${label} counter reset: ${baseline} -> ${current}`);
    }
    if (current > baseline) {
        throw new Error(`Warm playback recorded ${label}: ${baseline} -> ${current}`);
    }
}

function validateWarmPlaybackSnapshot({
    baseline,
    current,
    expectedAudioDeviceCount,
    previousCapturedAtMs,
    previousPlaybackTotalDuration,
    previousPlayheadPosition,
}: {
    baseline: RuntimeSnapshot;
    current: RuntimeSnapshot;
    expectedAudioDeviceCount: number;
    previousCapturedAtMs?: number;
    previousPlaybackTotalDuration?: number;
    previousPlayheadPosition?: number;
}): { capturedAtMs: number; playbackTotalDuration: number; playheadPosition: number } {
    const capturedAtMs = current.capturedAtMs;
    if (!Number.isFinite(capturedAtMs)) {
        throw new TypeError('Warm runtime snapshot must expose a finite monotonic capture timestamp');
    }
    if (previousCapturedAtMs !== undefined && capturedAtMs <= previousCapturedAtMs) {
        throw new Error('Warm runtime snapshot timestamp did not advance during the preparation window');
    }
    const transport = getRecord(current.transport, 'Warm transport state');
    if (current.visibilityState !== 'visible') {
        throw new Error(`Warm playback page became ${current.visibilityState}`);
    }
    if (transport.isPlaying !== true) {
        throw new Error('Warm playback transport stopped during the preparation window');
    }
    const playheadPosition = current.livePlayheadPosition;
    if (!Number.isFinite(playheadPosition)) {
        throw new TypeError('Warm transport state must expose a finite live playhead position');
    }
    if (previousPlayheadPosition !== undefined && playheadPosition <= previousPlayheadPosition) {
        throw new Error('Warm playback playhead stalled during the preparation window');
    }

    const audio = getRecord(current.audio, 'Warm audio diagnostics');
    const context = getRecord(audio.context, 'Warm AudioContext diagnostics');
    if (context.state !== 'running') {
        throw new Error(`Warm AudioContext entered ${String(context.state)} state`);
    }
    const graph = getRecord(audio.graph, 'Warm audio graph diagnostics');
    if (getNumber(graph, 'deviceInstances', 'Warm audio graph diagnostics') !== expectedAudioDeviceCount) {
        throw new Error('Warm audio graph no longer matches the expected Mycelium device count');
    }
    for (const name of ['pendingDeviceInstances', 'failedDeviceInstances']) {
        if (getNumber(graph, name, 'Warm audio graph diagnostics') !== 0) {
            throw new Error(`Warm audio graph reported ${name}`);
        }
    }

    const readiness = getRecord(current.readiness, 'Warm device readiness diagnostics');
    const baselineReadiness = getRecord(baseline.readiness, 'Baseline warm device readiness diagnostics');
    if (getReadinessGeneration(readiness) !== getReadinessGeneration(baselineReadiness)) {
        throw new Error('Warm device readiness generation changed during the preparation window');
    }
    const readinessCounts = getRecord(readiness.counts, 'Warm device readiness counts');
    const requested = getNumber(readinessCounts, 'requested', 'Warm device readiness counts');
    const playableReady = getNumber(readinessCounts, 'playableReady', 'Warm device readiness counts');
    const failed = getNumber(readinessCounts, 'failed', 'Warm device readiness counts');
    const cancelled = getNumber(readinessCounts, 'cancelled', 'Warm device readiness counts');
    if (
        expectedAudioDeviceCount <= 0 ||
        requested !== expectedAudioDeviceCount ||
        playableReady !== expectedAudioDeviceCount ||
        failed !== 0 ||
        cancelled !== 0
    ) {
        throw new Error('Warm device readiness stopped being completely playable');
    }

    const health = getRecord(current.health, 'Warm audio health');
    if (health.workletReady !== true || health.lastInitError !== null || health.lastResumeError !== null) {
        throw new Error('Warm audio engine reported a worklet, initialization, or resume fault');
    }
    const baselineHealth = getRecord(baseline.health, 'Baseline warm audio health');
    const dropouts = getRecord(health.dropouts, 'Warm audio dropout counters');
    const baselineDropouts = getRecord(baselineHealth.dropouts, 'Baseline warm audio dropout counters');
    for (const name of ['detectedUnderrunBlocks', 'silentFrames']) {
        assertWarmCounterStable({
            baseline: getNumber(baselineDropouts, name, 'Baseline warm audio dropout counters'),
            current: getNumber(dropouts, name, 'Warm audio dropout counters'),
            label: name,
            requireCleanBaseline: false,
        });
    }

    const playback = getRecord(audio.playback, 'Warm Chrome playback statistics');
    const playbackTotalDuration = getNumber(playback, 'totalDuration', 'Warm Chrome playback statistics');
    if (previousPlaybackTotalDuration !== undefined && playbackTotalDuration <= previousPlaybackTotalDuration) {
        throw new Error('Warm Chrome playback statistics did not advance during the preparation window');
    }
    if (previousPlaybackTotalDuration !== undefined && previousCapturedAtMs !== undefined) {
        const playbackDurationAdvance = playbackTotalDuration - previousPlaybackTotalDuration;
        const elapsedSeconds = (capturedAtMs - previousCapturedAtMs) / 1_000;
        const minimumPlaybackDurationAdvance = elapsedSeconds * WARM_MINIMUM_REALTIME_RATIO;
        if (playbackDurationAdvance < minimumPlaybackDurationAdvance) {
            throw new Error(
                `Warm Chrome playback statistics advanced too slowly: ${playbackDurationAdvance.toFixed(3)}s ` +
                    `for a required ${minimumPlaybackDurationAdvance.toFixed(3)}s`
            );
        }
    }
    const baselineAudio = getRecord(baseline.audio, 'Baseline warm audio diagnostics');
    const baselinePlayback = getRecord(baselineAudio.playback, 'Baseline warm Chrome playback statistics');
    for (const name of ['underrunDuration', 'underrunEvents']) {
        assertWarmCounterStable({
            baseline: getNumber(baselinePlayback, name, 'Baseline warm Chrome playback statistics'),
            current: getNumber(playback, name, 'Warm Chrome playback statistics'),
            label: `Chrome ${name}`,
            requireCleanBaseline: false,
        });
    }

    const scheduler = getRecord(current.scheduler, 'Warm scheduler diagnostics');
    const baselineScheduler = getRecord(baseline.scheduler, 'Baseline warm scheduler diagnostics');
    for (const name of ['sequenceGaps', 'outOfOrderMessages', 'ticksSkippedInFlight']) {
        assertWarmCounterStable({
            baseline: getNumber(baselineScheduler, name, 'Baseline warm scheduler diagnostics'),
            current: getNumber(scheduler, name, 'Warm scheduler diagnostics'),
            label: `scheduler ${name}`,
        });
    }
    const mainDeliveryLateness = getRecord(scheduler.mainDeliveryLatenessMs, 'Warm scheduler delivery latency');
    const maximumDeliveryLatenessMs = getNumber(mainDeliveryLateness, 'max', 'Warm scheduler delivery latency');
    if (maximumDeliveryLatenessMs > WARM_SCHEDULER_LOOKAHEAD_MS) {
        throw new Error(
            `Warm scheduler delivery breached its ${String(WARM_SCHEDULER_LOOKAHEAD_MS)}ms look-ahead horizon: ` +
                `${maximumDeliveryLatenessMs.toFixed(3)}ms`
        );
    }

    return { capturedAtMs, playbackTotalDuration, playheadPosition };
}

export async function warmPlaybackBeforeReplacement({
    expectedAudioDeviceCount,
    onSnapshot,
    readSnapshot,
    wait,
}: WarmPlaybackBeforeReplacementInput): Promise<RuntimeSnapshot[]> {
    const baseline = await readSnapshot();
    onSnapshot?.(baseline);
    const snapshots = [baseline];
    let previousProgress = validateWarmPlaybackSnapshot({
        baseline,
        current: baseline,
        expectedAudioDeviceCount,
    });
    let elapsedMs = 0;
    while (elapsedMs < WARM_PLAYBACK_BEFORE_REPLACEMENT_MS) {
        const waitMs = Math.min(WARM_PLAYBACK_SAMPLE_INTERVAL_MS, WARM_PLAYBACK_BEFORE_REPLACEMENT_MS - elapsedMs);
        await wait(waitMs);
        elapsedMs += waitMs;
        const current = await readSnapshot();
        onSnapshot?.(current);
        previousProgress = validateWarmPlaybackSnapshot({
            baseline,
            current,
            expectedAudioDeviceCount,
            previousCapturedAtMs: previousProgress.capturedAtMs,
            previousPlaybackTotalDuration: previousProgress.playbackTotalDuration,
            previousPlayheadPosition: previousProgress.playheadPosition,
        });
        snapshots.push(current);
    }
    return snapshots;
}

export async function startMyceliumPlaybackForReadiness(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Play', exact: true }).click({ timeout: 12_000 });
    await waitForTransportPlaying(page, true);
}

export async function stopMyceliumPlaybackAfterReadiness(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Stop', exact: true }).click({ timeout: 12_000 });
    await waitForTransportPlaying(page, false);
}

export async function rebuildMycelium(page: Page): Promise<void> {
    const created = await settleWithin(
        page.evaluate(
            async ({ modulePath, templateId }) => {
                const projectModule: unknown = await import(modulePath);
                if (typeof projectModule !== 'object' || projectModule === null) {
                    throw new TypeError('Project use-case contract is not an object');
                }
                const createFromTemplate: unknown = Reflect.get(projectModule, 'createFromTemplate');
                if (typeof createFromTemplate !== 'function') {
                    throw new TypeError('Project use-case contract does not expose createFromTemplate');
                }
                return (await Reflect.apply(createFromTemplate, undefined, [templateId])) === true;
            },
            { modulePath: PROJECT_USE_CASES_PATH, templateId: MYCELIUM_TEMPLATE_ID }
        ),
        180_000,
        'Warm Mycelium project replacement'
    );
    expect(created).toBe(true);
}

export async function readPageMemory({ label, page }: ReadPageMemoryInput): Promise<PageMemoryCheckpoint> {
    return settleWithin(
        page.evaluate(async () => {
            const measureMemory: unknown = Reflect.get(performance, 'measureUserAgentSpecificMemory');
            if (typeof measureMemory !== 'function') {
                throw new TypeError('Current stable Chrome did not expose measureUserAgentSpecificMemory');
            }
            const result: unknown = await Reflect.apply(measureMemory, performance, []);
            if (typeof result !== 'object' || result === null) {
                throw new TypeError('measureUserAgentSpecificMemory returned no result');
            }
            const bytes: unknown = Reflect.get(result, 'bytes');
            if (typeof bytes !== 'number' || !Number.isFinite(bytes)) {
                throw new TypeError('measureUserAgentSpecificMemory returned an invalid byte count');
            }
            return { bytes, capturedAtMs: performance.timeOrigin + performance.now(), result };
        }),
        60_000,
        label
    );
}
export async function startLongTaskWindow(page: Page): Promise<void> {
    await settleWithin(
        page.evaluate(
            ({ key, limit }) => {
                const prior: unknown = Reflect.get(globalThis, key);
                if (typeof prior === 'object' && prior !== null) {
                    const priorObserver: unknown = Reflect.get(prior, 'observer');
                    if (priorObserver instanceof PerformanceObserver) {
                        priorObserver.disconnect();
                    }
                }
                const startedAtMs = performance.now();
                const state = {
                    count: 0,
                    startedAtMs,
                    totalDurationMs: 0,
                    worst: [] as Array<{ durationMs: number; name: string; startTimeMs: number }>,
                };
                const record = (entry: PerformanceEntry): void => {
                    if (entry.startTime < startedAtMs) {
                        return;
                    }
                    state.count++;
                    state.totalDurationMs += entry.duration;
                    const candidate = { durationMs: entry.duration, name: entry.name, startTimeMs: entry.startTime };
                    if (state.worst.length < limit) {
                        state.worst.push(candidate);
                        return;
                    }
                    let shortestIndex = 0;
                    for (let index = 1; index < state.worst.length; index++) {
                        const current = state.worst.at(index);
                        const shortest = state.worst.at(shortestIndex);
                        if (!current || !shortest) {
                            throw new Error('Long-task ranking state became inconsistent');
                        }
                        if (current.durationMs < shortest.durationMs) {
                            shortestIndex = index;
                        }
                    }
                    const shortest = state.worst.at(shortestIndex);
                    if (!shortest) {
                        throw new Error('Long-task ranking has no shortest entry');
                    }
                    if (candidate.durationMs > shortest.durationMs) {
                        state.worst[shortestIndex] = candidate;
                    }
                };
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        record(entry);
                    }
                });
                observer.observe({ buffered: false, type: 'longtask' });
                Reflect.set(globalThis, key, { observer, record, state });
            },
            { key: LONG_TASK_WINDOW_KEY, limit: LONG_TASK_LIMIT }
        ),
        10_000,
        'Long-task window start'
    );
}

export async function stopLongTaskWindow(page: Page): Promise<LongTaskWindow> {
    return settleWithin(
        page.evaluate((key) => {
            const container: unknown = Reflect.get(globalThis, key);
            if (typeof container !== 'object' || container === null) {
                throw new TypeError('Long-task window is not active');
            }
            const observer: unknown = Reflect.get(container, 'observer');
            const record: unknown = Reflect.get(container, 'record');
            const state: unknown = Reflect.get(container, 'state');
            if (
                !(observer instanceof PerformanceObserver) ||
                typeof record !== 'function' ||
                typeof state !== 'object' ||
                state === null
            ) {
                throw new TypeError('Long-task window state is invalid');
            }
            for (const entry of observer.takeRecords()) {
                Reflect.apply(record, undefined, [entry]);
            }
            observer.disconnect();
            Reflect.deleteProperty(globalThis, key);
            const count: unknown = Reflect.get(state, 'count');
            const startedAtMs: unknown = Reflect.get(state, 'startedAtMs');
            const totalDurationMs: unknown = Reflect.get(state, 'totalDurationMs');
            const worst: unknown = Reflect.get(state, 'worst');
            if (
                typeof count !== 'number' ||
                typeof startedAtMs !== 'number' ||
                typeof totalDurationMs !== 'number' ||
                !Array.isArray(worst)
            ) {
                throw new TypeError('Long-task window aggregates are invalid');
            }
            const measuredWorst = worst.filter(
                (entry): entry is { durationMs: number; name: string; startTimeMs: number } =>
                    typeof entry === 'object' &&
                    entry !== null &&
                    typeof Reflect.get(entry, 'durationMs') === 'number' &&
                    typeof Reflect.get(entry, 'name') === 'string' &&
                    typeof Reflect.get(entry, 'startTimeMs') === 'number'
            );
            if (measuredWorst.length !== worst.length) {
                throw new TypeError('Long-task window retained an invalid entry');
            }
            const sortedWorst = [...measuredWorst].sort((left, right) => right.durationMs - left.durationMs);
            return {
                count,
                endedAtMs: performance.now(),
                maxDurationMs: sortedWorst[0]?.durationMs ?? 0,
                startedAtMs,
                totalDurationMs,
                worst: sortedWorst,
            };
        }, LONG_TASK_WINDOW_KEY),
        5_000,
        'Long-task window stop'
    );
}

export async function rejectOnPageErrorDuring<T>({
    abort,
    captureBeforeAbort,
    label,
    operation,
    page,
    pageError: monitoredPageError,
    timeoutMs,
}: RejectOnPageErrorDuringInput<T>): Promise<T> {
    let rejectPageError: (error: Error) => void = () => undefined;
    const pageError =
        monitoredPageError ??
        new Promise<never>((_resolve, reject) => {
            rejectPageError = reject;
        });
    const onPageError = (error: Error): void => rejectPageError(error);
    if (!monitoredPageError) {
        page.on('pageerror', onPageError);
    }
    let runningOperation: Promise<T> | null = null;
    try {
        runningOperation = Promise.resolve().then(operation);
        return await settleWithin(Promise.race([runningOperation, pageError]), timeoutMs, label);
    } catch (error) {
        const cleanupErrors: unknown[] = [];
        if (captureBeforeAbort) {
            try {
                await settleWithin(captureBeforeAbort(error), 15_000, `${label} failure evidence`);
            } catch (captureError) {
                cleanupErrors.push(captureError);
            }
        }
        try {
            await abort();
        } catch (abortError) {
            cleanupErrors.push(abortError);
        }
        if (runningOperation) {
            try {
                await settleWithin(
                    runningOperation.then(
                        () => undefined,
                        () => undefined
                    ),
                    10_000,
                    `${label} operation drain`
                );
            } catch (drainError) {
                cleanupErrors.push(drainError);
            }
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError([error, ...cleanupErrors], `${label} failed during bounded cleanup`);
        }
        throw error;
    } finally {
        if (!monitoredPageError) {
            page.off('pageerror', onPageError);
        }
    }
}

export async function waitForPlayableDevices({
    page,
    successorOfGeneration,
    timeoutMs = 120_000,
}: PlayableDeviceWaitInput): Promise<PlayableDeviceWait> {
    const startedAtMs = performance.now();
    const deadlineAtMs = startedAtMs + timeoutMs;
    const expectedGeneration = successorOfGeneration === undefined ? undefined : successorOfGeneration + 1;
    if (expectedGeneration !== undefined && !Number.isSafeInteger(expectedGeneration)) {
        throw new TypeError('Expected readiness generation must be a safe integer');
    }
    const expectedAudioDeviceCount: number = await settleBefore(
        page.evaluate(async (modulePath: string): Promise<number> => {
            const arrangementModule: unknown = await import(modulePath);
            if (typeof arrangementModule !== 'object' || arrangementModule === null) {
                throw new TypeError('Arrangement store contract is unavailable');
            }
            const trackStore: unknown = Reflect.get(arrangementModule, 'trackStore');
            const shouldCreateLiveTrackStrip: unknown = Reflect.get(arrangementModule, 'shouldCreateLiveTrackStrip');
            const state: unknown =
                typeof trackStore === 'object' && trackStore !== null ? Reflect.get(trackStore, 'value') : null;
            const tracks: unknown = typeof state === 'object' && state !== null ? Reflect.get(state, 'tracks') : null;
            const isCallable = (value: unknown): value is (track: unknown) => unknown => typeof value === 'function';
            if (!Array.isArray(tracks) || !isCallable(shouldCreateLiveTrackStrip)) {
                throw new TypeError('Arrangement store does not expose live-track eligibility');
            }
            const trackValues: unknown[] = tracks.filter(
                (track: unknown) => shouldCreateLiveTrackStrip(track) === true
            );
            return trackValues.reduce<number>((total, track) => {
                const devices: unknown =
                    typeof track === 'object' && track !== null ? Reflect.get(track, 'devices') : undefined;
                if (!Array.isArray(devices)) {
                    throw new TypeError('Arrangement track has no device list');
                }
                let audioDeviceCount = 0;
                for (const device of devices) {
                    const deviceType: unknown =
                        typeof device === 'object' && device !== null ? Reflect.get(device, 'type') : null;
                    if (typeof deviceType !== 'string') {
                        throw new TypeError('Arrangement device has no type');
                    }
                    // Yeast is a MIDI scheduler and intentionally owns no WebAudio node.
                    if (deviceType !== 'yeast') {
                        audioDeviceCount++;
                    }
                }
                return total + audioDeviceCount;
            }, 0);
        }, ARRANGEMENT_STORES_PATH),
        deadlineAtMs,
        'Arrangement device census'
    );

    let snapshot = await settleBefore(readRuntimeSnapshot(page), deadlineAtMs, 'Initial runtime snapshot');
    while (performance.now() - startedAtMs < timeoutMs) {
        const readiness = getRecord(snapshot.readiness, 'Device readiness snapshot');
        const readinessGeneration = getReadinessGeneration(readiness);
        const counts = getRecord(readiness.counts, 'Device readiness counts');
        const devices = readiness.devices;
        const requested = getNumber(counts, 'requested', 'Device readiness counts');
        const playableReady = getNumber(counts, 'playableReady', 'Device readiness counts');
        const failed = getNumber(counts, 'failed', 'Device readiness counts');
        const cancelled = getNumber(counts, 'cancelled', 'Device readiness counts');
        const audio = getRecord(snapshot.audio, 'Audio diagnostics');
        const graph = getRecord(audio.graph, 'Audio graph census');
        const graphReady = getNumber(graph, 'deviceInstances', 'Audio graph census');
        const graphPending = getNumber(graph, 'pendingDeviceInstances', 'Audio graph census');
        const graphFailed = getNumber(graph, 'failedDeviceInstances', 'Audio graph census');
        if (!Array.isArray(devices)) {
            throw new TypeError('Device readiness snapshot must expose device records');
        }
        const readinessRecords = devices.map((device) => getRecord(device, 'Device readiness record'));
        const statuses = readinessRecords.map((record) => record.status);
        const isExpectedGeneration = expectedGeneration === undefined || readinessGeneration === expectedGeneration;
        const skippedExpectedGeneration = expectedGeneration !== undefined && readinessGeneration > expectedGeneration;
        if (
            failed > 0 ||
            cancelled > 0 ||
            graphFailed > 0 ||
            statuses.includes('failed') ||
            skippedExpectedGeneration
        ) {
            return {
                outcome: 'failed',
                elapsedMs: performance.now() - startedAtMs,
                expectedAudioDeviceCount,
                readinessGeneration,
                snapshot,
            };
        }
        const graphDeviceCount = graphReady + graphPending + graphFailed;
        if (
            expectedAudioDeviceCount > 0 &&
            requested === expectedAudioDeviceCount &&
            playableReady === expectedAudioDeviceCount &&
            devices.length === expectedAudioDeviceCount &&
            graphDeviceCount === expectedAudioDeviceCount &&
            graphPending === 0 &&
            isExpectedGeneration &&
            statuses.every((status) => status === 'ready')
        ) {
            return {
                outcome: 'ready',
                elapsedMs: performance.now() - startedAtMs,
                expectedAudioDeviceCount,
                readinessGeneration,
                snapshot,
            };
        }
        const pollDelayMs = Math.min(250, Math.max(1, Math.ceil(deadlineAtMs - performance.now())));
        await page.waitForTimeout(pollDelayMs);
        if (performance.now() >= deadlineAtMs) {
            break;
        }
        snapshot = await settleBefore(readRuntimeSnapshot(page), deadlineAtMs, 'Runtime readiness snapshot');
    }
    const readiness = getRecord(snapshot.readiness, 'Device readiness snapshot');
    return {
        outcome: 'timeout',
        elapsedMs: performance.now() - startedAtMs,
        expectedAudioDeviceCount,
        readinessGeneration: getReadinessGeneration(readiness),
        snapshot,
    };
}

export async function readRuntimeSnapshot(page: Page): Promise<RuntimeSnapshot> {
    return page.evaluate(
        async ({ audioPath, projectStoresPath, transportPath, transportStoresPath }) => {
            const audioModule: unknown = await import(audioPath);
            const projectStoresModule: unknown = await import(projectStoresPath);
            const transportModule: unknown = await import(transportPath);
            const transportStoresModule: unknown = await import(transportStoresPath);
            const call = (moduleValue: unknown, name: string): unknown => {
                if (typeof moduleValue !== 'object' || moduleValue === null) {
                    throw new TypeError(`${name} contract is not an object`);
                }
                const operation: unknown = Reflect.get(moduleValue, name);
                const isCallable = (value: unknown): value is (...args: unknown[]) => unknown =>
                    typeof value === 'function';
                if (!isCallable(operation)) {
                    throw new TypeError(`Runtime contract does not expose ${name}`);
                }
                return operation();
            };
            if (typeof transportStoresModule !== 'object' || transportStoresModule === null) {
                throw new TypeError('Transport stores contract is not an object');
            }
            const playheadPositionRef: unknown = Reflect.get(transportStoresModule, 'playheadPositionRef');
            const livePlayheadPosition: unknown =
                typeof playheadPositionRef === 'object' && playheadPositionRef !== null
                    ? Reflect.get(playheadPositionRef, 'current')
                    : null;
            if (typeof livePlayheadPosition !== 'number' || !Number.isFinite(livePlayheadPosition)) {
                throw new TypeError('Transport stores contract does not expose a finite live playhead position');
            }
            if (typeof projectStoresModule !== 'object' || projectStoresModule === null) {
                throw new TypeError('Project stores contract is not an object');
            }
            const projectStore: unknown = Reflect.get(projectStoresModule, 'projectStore');
            const projectState: unknown =
                typeof projectStore === 'object' && projectStore !== null ? Reflect.get(projectStore, 'value') : null;
            const projectDirty: unknown =
                typeof projectState === 'object' && projectState !== null ? Reflect.get(projectState, 'dirty') : null;
            if (projectDirty !== null && typeof projectDirty !== 'boolean') {
                throw new TypeError('Project store dirty state must be boolean or null');
            }
            const probeDurationMs: Record<string, number> = {};
            const timedCall = (moduleValue: unknown, name: string): unknown => {
                const startedAtMs = performance.now();
                const result = call(moduleValue, name);
                probeDurationMs[name] = performance.now() - startedAtMs;
                return result;
            };
            return {
                capturedAtMs: performance.timeOrigin + performance.now(),
                audio: timedCall(audioModule, 'getEngineDiagnostics'),
                health: timedCall(audioModule, 'getEngineHealth'),
                livePlayheadPosition,
                projectDirty,
                probeDurationMs,
                readiness: timedCall(audioModule, 'getDeviceReadinessDiagnostics'),
                scheduler: timedCall(transportModule, 'getSchedulerTimingDiagnostics'),
                transport: timedCall(transportModule, 'getTransportState'),
                visibilityState: document.visibilityState,
            };
        },
        {
            audioPath: AUDIO_USE_CASES_PATH,
            projectStoresPath: PROJECT_STORES_PATH,
            transportPath: TRANSPORT_USE_CASES_PATH,
            transportStoresPath: TRANSPORT_STORES_PATH,
        }
    );
}

export async function captureFailureEvidence({
    testInfo,
    page,
    environment,
    error,
    partial,
}: CaptureFailureEvidenceInput): Promise<void> {
    let runtime: unknown = null;
    if (page) {
        try {
            runtime = await settleWithin(readRuntimeSnapshot(page), 5_000, 'Failure runtime snapshot');
        } catch (runtimeError) {
            runtime = { captureError: String(runtimeError) };
        }
    }
    await attachEvidence(testInfo, 'mycelium-performance-failure', {
        environment,
        error:
            error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        partial,
        runtime,
    });
    if (page) {
        const screenshotPath = testInfo.outputPath('mycelium-performance-failure.png');
        await page.screenshot({ fullPage: true, path: screenshotPath, timeout: 5_000 });
        await testInfo.attach('mycelium-performance-failure-page', {
            path: screenshotPath,
            contentType: 'image/png',
        });
    }
}

export async function attachEvidence(testInfo: TestInfo, name: string, evidence: unknown): Promise<void> {
    await testInfo.attach(name, {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
    });
}
