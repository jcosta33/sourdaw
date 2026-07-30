import { chromium, expect, type Browser, type Page, type TestInfo } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const AUDIO_USE_CASES_PATH = '/src/modules/AudioEngine/useCases/index.ts';
const ARRANGEMENT_STORES_PATH = '/src/modules/Arrangement/stores/index.ts';
const PROJECT_USE_CASES_PATH = '/src/modules/Project/useCases/index.ts';
const TRANSPORT_USE_CASES_PATH = '/src/modules/Transport/useCases/index.ts';
const LONG_TASK_LIMIT = 20;
const MYCELIUM_TEMPLATE_ID = 'demo-mycelium-ascendant';
const LONG_TASK_WINDOW_KEY = '__SOURDAW_PERF_LONG_TASK_WINDOW__';

type RuntimeCapabilities = {
    crossOriginIsolated: boolean;
    hasLongTasks: boolean;
    hasMeasureMemory: boolean;
    userAgent: string;
};

export type RuntimeSnapshot = {
    capturedAtMs: number;
    audio: unknown;
    readiness: unknown;
    scheduler: unknown;
    transport: unknown;
};

export type PlayableDeviceWait = {
    outcome: 'ready' | 'failed' | 'timeout';
    elapsedMs: number;
    expectedAudioDeviceCount: number;
    snapshot: RuntimeSnapshot;
};

type PlayableDeviceWaitInput = {
    page: Page;
    baseline?: RuntimeSnapshot;
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
    headless: boolean;
    smoke: boolean;
    audioLatencyProfile: MyceliumEvidenceEnvironment['audioLatencyProfile'];
    os: MyceliumEvidenceEnvironment['os'];
};

export type MyceliumEvidenceEnvironment = {
    gitSha: string;
    gitDirty: boolean;
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
    audioLatencyProfile: 'low-latency' | 'high-capacity';
    repeatIndex: number;
    capabilities: RuntimeCapabilities;
};

type OpenMeasuredPageOutput = {
    browser: Browser;
    page: Page;
    environment: MyceliumEvidenceEnvironment;
};

type CaptureFailureEvidenceInput = {
    testInfo: TestInfo;
    page: Page | null;
    environment: unknown;
    error: unknown;
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

function readPerformanceMetadata(testInfo: TestInfo): PerformanceMetadata {
    const metadata = getRecord(testInfo.project.metadata, 'Playwright project metadata');
    const performanceMetadata = getRecord(metadata.performance, 'Playwright performance metadata');
    const os = getRecord(performanceMetadata.os, 'Playwright OS metadata');
    const gitSha = performanceMetadata.gitSha;
    const gitDirty = performanceMetadata.gitDirty;
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
        typeof headless !== 'boolean' ||
        typeof smoke !== 'boolean' ||
        (audioLatencyProfile !== 'low-latency' && audioLatencyProfile !== 'high-capacity') ||
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
    const browser = await chromium.launch({ channel: 'chrome', headless: metadata.headless });
    let page: Page | null = null;
    try {
        const context = await browser.newContext({
            baseURL: getBaseUrl(testInfo),
            viewport: { width: 1920, height: 1080 },
        });
        page = await context.newPage();
        const pagePath = `/?audioLatencyProfile=${metadata.audioLatencyProfile}`;
        await setupWorkspace(page, pagePath);

        const capabilities = await readCapabilities(page);
        expect(capabilities.crossOriginIsolated).toBe(true);
        expect(capabilities.hasLongTasks).toBe(true);
        expect(capabilities.hasMeasureMemory).toBe(true);
        const initialSnapshot = await readRuntimeSnapshot(page);
        const audioDiagnostics = getRecord(initialSnapshot.audio, 'Audio diagnostics');
        const audioContext = getRecord(audioDiagnostics.context, 'Audio diagnostics context');
        expect(audioContext.requestedLatencyProfile).toBe(metadata.audioLatencyProfile);

        return {
            browser,
            page,
            environment: {
                gitSha: metadata.gitSha,
                gitDirty: metadata.gitDirty,
                browserVersion: browser.version(),
                os: metadata.os,
                viewport: { width: 1920, height: 1080 },
                headless: metadata.headless,
                smoke: metadata.smoke,
                audioLatencyProfile: metadata.audioLatencyProfile,
                repeatIndex: testInfo.repeatEachIndex,
                capabilities,
            },
        };
    } catch (error) {
        await captureFailureEvidence({
            testInfo,
            page,
            environment: { ...metadata, browserVersion: browser.version() },
            error,
        }).catch(() => undefined);
        await browser.close().catch(() => undefined);
        throw error;
    }
}

export async function launchMycelium(page: Page): Promise<void> {
    await page.locator('#launch-demo-project').click();
    const card = page.getByRole('button', { name: /Mycelium Ascendant/i });
    await expect(card).toBeVisible();
    await card.click();
    await wait_for_workspace_ready(page);
}

export async function rebuildMycelium(page: Page): Promise<void> {
    const created = await page.evaluate(
        async ({ modulePath, templateId }) => {
            const projectModule: unknown = await import(modulePath);
            if (typeof projectModule !== 'object' || projectModule === null) {
                throw new TypeError('Project use-case contract is not an object');
            }
            const createFromTemplate: unknown = Reflect.get(projectModule, 'createFromTemplate');
            const isCallable = (value: unknown): value is (...args: unknown[]) => unknown =>
                typeof value === 'function';
            if (!isCallable(createFromTemplate)) {
                throw new TypeError('Project use-case contract does not expose createFromTemplate');
            }
            return (await createFromTemplate(templateId)) === true;
        },
        { modulePath: PROJECT_USE_CASES_PATH, templateId: MYCELIUM_TEMPLATE_ID }
    );
    expect(created).toBe(true);
}

function readinessCounts(snapshot: RuntimeSnapshot | undefined): Record<string, number> {
    if (!snapshot) {
        return { requested: 0, playableReady: 0, failed: 0, cancelled: 0 };
    }
    const readiness = getRecord(snapshot.readiness, 'Device readiness snapshot');
    const counts = getRecord(readiness.counts, 'Device readiness counts');
    return {
        requested: getNumber(counts, 'requested', 'Device readiness counts'),
        playableReady: getNumber(counts, 'playableReady', 'Device readiness counts'),
        failed: getNumber(counts, 'failed', 'Device readiness counts'),
        cancelled: getNumber(counts, 'cancelled', 'Device readiness counts'),
    };
}

export async function waitForPlayableDevices({
    page,
    baseline,
    timeoutMs = 120_000,
}: PlayableDeviceWaitInput): Promise<PlayableDeviceWait> {
    const baselineCounts = readinessCounts(baseline);
    const expectedAudioDeviceCount: number = await page.evaluate(async (modulePath: string): Promise<number> => {
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
        const trackValues: unknown[] = tracks.filter((track: unknown) => shouldCreateLiveTrackStrip(track) === true);
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
    }, ARRANGEMENT_STORES_PATH);

    const startedAtMs = performance.now();
    let snapshot = await readRuntimeSnapshot(page);
    while (performance.now() - startedAtMs < timeoutMs) {
        const readiness = getRecord(snapshot.readiness, 'Device readiness snapshot');
        const counts = getRecord(readiness.counts, 'Device readiness counts');
        const devices = readiness.devices;
        const requested = getNumber(counts, 'requested', 'Device readiness counts');
        const playableReady = getNumber(counts, 'playableReady', 'Device readiness counts');
        const failed = getNumber(counts, 'failed', 'Device readiness counts');
        const cancelled = getNumber(counts, 'cancelled', 'Device readiness counts');
        const requestedDelta = requested - baselineCounts.requested;
        const playableReadyDelta = playableReady - baselineCounts.playableReady;
        const failedDelta = failed - baselineCounts.failed;
        const cancelledDelta = cancelled - baselineCounts.cancelled;
        const audio = getRecord(snapshot.audio, 'Audio diagnostics');
        const graph = getRecord(audio.graph, 'Audio graph census');
        const graphReady = getNumber(graph, 'deviceInstances', 'Audio graph census');
        const graphPending = getNumber(graph, 'pendingDeviceInstances', 'Audio graph census');
        const graphFailed = getNumber(graph, 'failedDeviceInstances', 'Audio graph census');
        if (!Array.isArray(devices)) {
            throw new TypeError('Device readiness snapshot must expose device records');
        }
        const statuses = devices.map((device) => getRecord(device, 'Device readiness record').status);
        if (failedDelta > 0 || cancelledDelta > 0 || graphFailed > 0 || statuses.includes('failed')) {
            return {
                outcome: 'failed',
                elapsedMs: performance.now() - startedAtMs,
                expectedAudioDeviceCount,
                snapshot,
            };
        }
        const graphDeviceCount = graphReady + graphPending + graphFailed;
        if (
            requestedDelta > 0 &&
            requestedDelta === devices.length &&
            playableReadyDelta === devices.length &&
            graphDeviceCount === expectedAudioDeviceCount &&
            graphPending === 0 &&
            statuses.every((status) => status === 'ready')
        ) {
            return { outcome: 'ready', elapsedMs: performance.now() - startedAtMs, expectedAudioDeviceCount, snapshot };
        }
        await page.waitForTimeout(250);
        snapshot = await readRuntimeSnapshot(page);
    }
    return { outcome: 'timeout', elapsedMs: performance.now() - startedAtMs, expectedAudioDeviceCount, snapshot };
}

export async function readPageMemory(page: Page): Promise<PageMemoryCheckpoint> {
    return page.evaluate(async () => {
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
    });
}

export async function startLongTaskWindow(page: Page): Promise<void> {
    await page.evaluate(
        ({ key, limit }) => {
            const prior: unknown = Reflect.get(globalThis, key);
            if (typeof prior === 'object' && prior !== null) {
                const priorObserver: unknown = Reflect.get(prior, 'observer');
                if (priorObserver instanceof PerformanceObserver) {
                    priorObserver.disconnect();
                }
            }
            const startedAtMs = performance.now();
            const entries: Array<{ durationMs: number; name: string; startTimeMs: number }> = [];
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.startTime >= startedAtMs) {
                        entries.push({ durationMs: entry.duration, name: entry.name, startTimeMs: entry.startTime });
                    }
                }
            });
            observer.observe({ buffered: false, type: 'longtask' });
            Reflect.set(globalThis, key, { entries, limit, observer, startedAtMs });
        },
        { key: LONG_TASK_WINDOW_KEY, limit: LONG_TASK_LIMIT }
    );
}

export async function stopLongTaskWindow(page: Page): Promise<LongTaskWindow> {
    return page.evaluate((key) => {
        const state: unknown = Reflect.get(globalThis, key);
        if (typeof state !== 'object' || state === null) {
            throw new TypeError('Long-task window is not active');
        }
        const observer: unknown = Reflect.get(state, 'observer');
        const entries: unknown = Reflect.get(state, 'entries');
        const limit: unknown = Reflect.get(state, 'limit');
        const startedAtMs: unknown = Reflect.get(state, 'startedAtMs');
        if (
            !(observer instanceof PerformanceObserver) ||
            !Array.isArray(entries) ||
            typeof limit !== 'number' ||
            typeof startedAtMs !== 'number'
        ) {
            throw new TypeError('Long-task window state is invalid');
        }
        for (const entry of observer.takeRecords()) {
            if (entry.startTime >= startedAtMs) {
                entries.push({ durationMs: entry.duration, name: entry.name, startTimeMs: entry.startTime });
            }
        }
        observer.disconnect();
        Reflect.deleteProperty(globalThis, key);
        const endedAtMs = performance.now();
        const measuredEntries = entries.filter(
            (entry): entry is { durationMs: number; name: string; startTimeMs: number } =>
                typeof entry === 'object' &&
                entry !== null &&
                typeof Reflect.get(entry, 'durationMs') === 'number' &&
                typeof Reflect.get(entry, 'name') === 'string' &&
                typeof Reflect.get(entry, 'startTimeMs') === 'number' &&
                Reflect.get(entry, 'startTimeMs') < endedAtMs
        );
        const worst = [...measuredEntries].sort((left, right) => right.durationMs - left.durationMs).slice(0, limit);
        const totalDurationMs = measuredEntries.reduce((total, entry) => total + entry.durationMs, 0);
        return {
            count: measuredEntries.length,
            endedAtMs,
            maxDurationMs: worst[0]?.durationMs ?? 0,
            startedAtMs,
            totalDurationMs,
            worst,
        };
    }, LONG_TASK_WINDOW_KEY);
}

export async function readRuntimeSnapshot(page: Page): Promise<RuntimeSnapshot> {
    return page.evaluate(
        async ({ audioPath, transportPath }) => {
            const audioModule: unknown = await import(audioPath);
            const transportModule: unknown = await import(transportPath);
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
            return {
                capturedAtMs: performance.timeOrigin + performance.now(),
                audio: call(audioModule, 'getEngineDiagnostics'),
                readiness: call(audioModule, 'getDeviceReadinessDiagnostics'),
                scheduler: call(transportModule, 'getSchedulerTimingDiagnostics'),
                transport: call(transportModule, 'getTransportState'),
            };
        },
        { audioPath: AUDIO_USE_CASES_PATH, transportPath: TRANSPORT_USE_CASES_PATH }
    );
}

export async function captureFailureEvidence({
    testInfo,
    page,
    environment,
    error,
}: CaptureFailureEvidenceInput): Promise<void> {
    let runtime: unknown = null;
    if (page) {
        try {
            runtime = await Promise.race([
                readRuntimeSnapshot(page),
                new Promise((resolve) =>
                    setTimeout(() => resolve({ captureError: 'Runtime snapshot timed out after 5 seconds' }), 5_000)
                ),
            ]);
        } catch (runtimeError) {
            runtime = { captureError: String(runtimeError) };
        }
    }
    await attachEvidence(testInfo, 'mycelium-performance-failure', {
        environment,
        error:
            error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
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
