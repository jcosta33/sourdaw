import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { expect, test, type CDPSession, type TestInfo } from '@playwright/test';

import {
    admitOfflineAudioWorkletTrace,
    OFFLINE_TRACE_EVENT_NAMES,
    OFFLINE_TRACE_PHASES,
    type TraceAdmission,
} from '../../scripts/offlineAudioWorkletTrace';

const QUANTUM_FRAMES = 128;
const SAMPLE_RATE = 48_000;
const RENDER_CALLBACKS = OFFLINE_TRACE_PHASES.warmupCallbacks + OFFLINE_TRACE_PHASES.measuredCallbacks;
const TOTAL_CALLBACKS = RENDER_CALLBACKS + OFFLINE_TRACE_PHASES.terminalCallbacks;
const TOTAL_FRAMES = TOTAL_CALLBACKS * QUANTUM_FRAMES;
const FIRST_SLOW_ORDINAL = OFFLINE_TRACE_PHASES.warmupCallbacks;
const MIDDLE_SLOW_ORDINAL = 14_000;
const LAST_SLOW_ORDINAL = RENDER_CALLBACKS - 1;
const TERMINAL_ORDINAL = RENDER_CALLBACKS;
const RAW_TRACE_BYTE_CAP = 64 * 1024 * 1024;
const TRACE_STREAM_CHUNK_BYTES = 1024 * 1024;
const TRACE_CATEGORIES = ['disabled-by-default-audio-worklet', 'disabled-by-default-webaudio.audionode'];

type TraceConfiguration = {
    recordMode: 'recordUntilFull';
    traceBufferSizeInKb: number;
    enableSampling: false;
    enableSystrace: false;
    includedCategories: string[];
};

const TRACE_CONFIGURATION: TraceConfiguration = {
    recordMode: 'recordUntilFull',
    traceBufferSizeInKb: RAW_TRACE_BYTE_CAP / 1024,
    enableSampling: false,
    enableSystrace: false,
    includedCategories: TRACE_CATEGORIES,
};

const WORKLET_SOURCE = `
const WARMUP_CALLBACKS = ${String(OFFLINE_TRACE_PHASES.warmupCallbacks)};
const MEASURED_CALLBACKS = ${String(OFFLINE_TRACE_PHASES.measuredCallbacks)};
const RENDER_CALLBACKS = WARMUP_CALLBACKS + MEASURED_CALLBACKS;
const FIRST_SLOW_ORDINAL = ${String(FIRST_SLOW_ORDINAL)};
const MIDDLE_SLOW_ORDINAL = ${String(MIDDLE_SLOW_ORDINAL)};
const LAST_SLOW_ORDINAL = ${String(LAST_SLOW_ORDINAL)};

class OfflineNativeTraceProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.callbackCount = 0;
        this.warmupCount = 0;
        this.measuredCount = 0;
        this.terminalCount = 0;
        this.frameMismatchCount = 0;
        this.firstFrame = -1;
        this.lastRenderFrame = -1;
        this.terminalFrame = -1;
        this.firstSlowTicks = 0;
        this.middleSlowTicks = 0;
        this.lastSlowTicks = 0;
    }

    consumeDateTicks(targetTicks) {
        const startedAt = Date.now();
        let elapsed = 0;
        while (elapsed < targetTicks) {
            elapsed = Date.now() - startedAt;
        }
        return elapsed;
    }

    process(inputs, outputs) {
        const ordinal = this.callbackCount;
        const expectedFrame = ordinal * 128;
        if (currentFrame !== expectedFrame) {
            this.frameMismatchCount++;
        }
        const output = outputs[0];

        if (ordinal === RENDER_CALLBACKS) {
            this.terminalCount++;
            this.terminalFrame = currentFrame;
            const terminalTicks = this.consumeDateTicks(12);
            for (let channel = 0; channel < output.length; channel++) {
                const samples = output[channel];
                for (let index = 0; index < samples.length; index++) {
                    samples[index] = 0;
                }
            }
            this.callbackCount++;
            this.port.postMessage({
                type: 'terminal',
                callbackCount: this.callbackCount,
                warmupCount: this.warmupCount,
                measuredCount: this.measuredCount,
                terminalCount: this.terminalCount,
                frameMismatchCount: this.frameMismatchCount,
                firstFrame: this.firstFrame,
                lastRenderFrame: this.lastRenderFrame,
                terminalFrame: this.terminalFrame,
                firstSlowOrdinal: FIRST_SLOW_ORDINAL,
                middleSlowOrdinal: MIDDLE_SLOW_ORDINAL,
                lastSlowOrdinal: LAST_SLOW_ORDINAL,
                firstSlowTicks: this.firstSlowTicks,
                middleSlowTicks: this.middleSlowTicks,
                lastSlowTicks: this.lastSlowTicks,
                terminalTicks,
            });
            return false;
        }

        if (this.firstFrame < 0) {
            this.firstFrame = currentFrame;
        }
        this.lastRenderFrame = currentFrame;
        if (ordinal < WARMUP_CALLBACKS) {
            this.warmupCount++;
        } else {
            this.measuredCount++;
        }
        if (ordinal === FIRST_SLOW_ORDINAL) {
            this.firstSlowTicks = this.consumeDateTicks(8);
        } else if (ordinal === MIDDLE_SLOW_ORDINAL) {
            this.middleSlowTicks = this.consumeDateTicks(8);
        } else if (ordinal === LAST_SLOW_ORDINAL) {
            this.lastSlowTicks = this.consumeDateTicks(8);
        }
        for (let channel = 0; channel < output.length; channel++) {
            const samples = output[channel];
            for (let index = 0; index < samples.length; index++) {
                samples[index] = 0.25;
            }
        }
        this.callbackCount++;
        return true;
    }
}

registerProcessor('offline-native-trace', OfflineNativeTraceProcessor);
`;

type TraceCompletion = {
    dataLossOccurred?: unknown;
    stream?: unknown;
    traceFormat?: unknown;
    streamCompression?: unknown;
};

type CapturedStream = {
    bytes: Buffer;
    complete: boolean;
};

type ProducerResult = {
    isSecureContext: boolean;
    receipt: unknown;
    processorErrors: number;
    renderedFrames: number;
    renderedSampleMismatches: number;
    terminalNonzeroSamples: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}

function numericMember(value: unknown, key: string): number | null {
    if (!isRecord(value)) {
        return null;
    }
    const member = value[key];
    return typeof member === 'number' && Number.isFinite(member) ? member : null;
}

function traceEventsFromJson(rawTrace: Buffer): readonly unknown[] | string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawTrace.toString('utf8'));
    } catch (error) {
        return `trace stream is not JSON: ${errorMessage(error)}`;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.traceEvents)) {
        return 'trace JSON has no traceEvents array';
    }
    return parsed.traceEvents;
}

function countNamedEvents(events: readonly unknown[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of events) {
        if (!isRecord(event) || typeof event.name !== 'string') {
            continue;
        }
        if (Object.values(OFFLINE_TRACE_EVENT_NAMES).some((name) => event.name === name)) {
            counts[event.name] = (counts[event.name] ?? 0) + 1;
        }
    }
    return counts;
}

function summarizeAdmission(admission: TraceAdmission): unknown {
    if (admission.status === 'refused') {
        return admission;
    }
    return {
        status: admission.status,
        outerCallbacks: admission.outerCallbacks,
        pid: admission.pid,
        tid: admission.tid,
        handlerThis: admission.handlerThis,
        warmupCallbacks: admission.warmupDurationsUs.length,
        measuredCallbacks: admission.measuredDurationsUs.length,
        terminalDurationUs: admission.terminalDurationUs,
        bareHandlers: admission.bareHandlers,
        selectedMeasuredDurationsUs: {
            first: admission.measuredDurationsUs[0],
            middle: admission.measuredDurationsUs[MIDDLE_SLOW_ORDINAL - FIRST_SLOW_ORDINAL],
            last: admission.measuredDurationsUs.at(-1),
        },
    };
}

async function readBoundedTraceStream(session: CDPSession, handle: string): Promise<CapturedStream> {
    const chunks: Buffer[] = [];
    let capturedBytes = 0;
    let complete = false;
    try {
        while (!complete) {
            const part = await session.send('IO.read', { handle, size: TRACE_STREAM_CHUNK_BYTES });
            const chunk = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
            const remaining = RAW_TRACE_BYTE_CAP - capturedBytes;
            if (chunk.byteLength > remaining) {
                chunks.push(chunk.subarray(0, Math.max(0, remaining)));
                return { bytes: Buffer.concat(chunks), complete: false };
            }
            chunks.push(chunk);
            capturedBytes += chunk.byteLength;
            complete = part.eof;
        }
        return { bytes: Buffer.concat(chunks), complete: true };
    } finally {
        await session.send('IO.close', { handle });
    }
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
    const path = testInfo.outputPath(`${name}.json`);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
    await testInfo.attach(name, { path, contentType: 'application/json' });
}

test('admits a complete native OfflineAudioWorklet callback population', async ({ browser, page }, testInfo) => {
    test.setTimeout(90_000);
    const baseUrl = testInfo.project.use.baseURL;
    if (typeof baseUrl !== 'string') {
        throw new TypeError('Native worklet trace admission requires the configured localhost E2E origin');
    }
    const probeUrl = new URL('/__offline-native-trace-probe__.html', baseUrl).href;
    await page.route(probeUrl, (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><meta charset="utf-8"><title>offline native trace probe</title>',
        })
    );
    await page.goto(probeUrl);

    const probeInput = {
        workletSource: WORKLET_SOURCE,
        frameCount: TOTAL_FRAMES,
        sampleRate: SAMPLE_RATE,
        renderCallbacks: RENDER_CALLBACKS,
        quantumFrames: QUANTUM_FRAMES,
    };
    const probe = await page.evaluateHandle(
        async ({ workletSource, frameCount, sampleRate, renderCallbacks, quantumFrames }) => {
            const context = new OfflineAudioContext(1, frameCount, sampleRate);
            const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
            await context.audioWorklet.addModule(moduleUrl);

            let processorErrors = 0;
            let resolveReceipt: (value: unknown) => void = () => undefined;
            const receiptPromise = new Promise<unknown>((resolve) => {
                resolveReceipt = resolve;
            });
            const node = new AudioWorkletNode(context, 'offline-native-trace', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1],
            });
            node.onprocessorerror = () => {
                processorErrors++;
            };
            node.port.onmessage = (event: MessageEvent<unknown>) => {
                resolveReceipt(event.data);
            };
            node.connect(context.destination);

            return {
                async run() {
                    const rendered = await context.startRendering();
                    const receipt = await Promise.race([
                        receiptPromise,
                        new Promise<null>((resolve) => {
                            setTimeout(() => resolve(null), 5_000);
                        }),
                    ]);
                    const samples = rendered.getChannelData(0);
                    let renderedSampleMismatches = 0;
                    for (let index = 0; index < renderCallbacks * quantumFrames; index++) {
                        if (samples[index] !== 0.25) {
                            renderedSampleMismatches++;
                        }
                    }
                    let terminalNonzeroSamples = 0;
                    for (let index = renderCallbacks * quantumFrames; index < samples.length; index++) {
                        if (samples[index] !== 0) {
                            terminalNonzeroSamples++;
                        }
                    }
                    return {
                        isSecureContext,
                        receipt,
                        processorErrors,
                        renderedFrames: samples.length,
                        renderedSampleMismatches,
                        terminalNonzeroSamples,
                    };
                },
                cleanup() {
                    node.disconnect();
                    URL.revokeObjectURL(moduleUrl);
                },
            };
        },
        probeInput
    );

    const session = await browser.newBrowserCDPSession();
    const version = await session.send('Browser.getVersion');
    const categories = await session.send('Tracing.getCategories');
    let maximumBufferUsage = 0;
    session.on('Tracing.bufferUsage', (usage) => {
        maximumBufferUsage = Math.max(maximumBufferUsage, usage.percentFull ?? usage.value ?? 0);
    });
    const completionPromise = new Promise<TraceCompletion>((resolve) => {
        session.once('Tracing.tracingComplete', resolve);
    });

    let producerResult: ProducerResult | null = null;
    let producerFailure: string | null = null;
    let completion: TraceCompletion = {};
    let captured: CapturedStream = { bytes: Buffer.alloc(0), complete: false };
    let captureFailure: string | null = null;
    let tracingStarted = false;
    try {
        await session.send('Tracing.start', {
            transferMode: 'ReturnAsStream',
            streamFormat: 'json',
            streamCompression: 'gzip',
            bufferUsageReportingInterval: 100,
            traceConfig: TRACE_CONFIGURATION,
        });
        tracingStarted = true;
        try {
            producerResult = await probe.evaluate((value) => value.run());
        } catch (error) {
            producerFailure = errorMessage(error);
        }
    } finally {
        try {
            if (tracingStarted) {
                await session.send('Tracing.end');
                completion = await completionPromise;
                if (typeof completion.stream === 'string') {
                    captured = await readBoundedTraceStream(session, completion.stream);
                } else {
                    captureFailure = 'Tracing.tracingComplete did not provide a stream';
                }
            }
        } catch (error) {
            captureFailure = errorMessage(error);
        } finally {
            await probe.evaluate((value) => value.cleanup());
            await probe.dispose();
            await session.detach();
            await page.unroute(probeUrl);
            await page.close();
        }
    }

    const rawTracePath = testInfo.outputPath(
        captured.complete ? 'offline-native-trace.json.gz' : 'offline-native-trace.partial.gz'
    );
    await writeFile(rawTracePath, captured.bytes);
    await testInfo.attach('offline-native-trace-raw', { path: rawTracePath, contentType: 'application/gzip' });

    let traceEvents: readonly unknown[] | string = captureFailure ?? 'trace capture did not complete';
    let rawTrace: Buffer | null = null;
    if (captured.complete && captureFailure === null) {
        try {
            rawTrace = gunzipSync(captured.bytes, { maxOutputLength: RAW_TRACE_BYTE_CAP });
            traceEvents = traceEventsFromJson(rawTrace);
        } catch (error) {
            traceEvents = `trace gzip could not be decoded within the ${String(RAW_TRACE_BYTE_CAP)}-byte cap: ${errorMessage(error)}`;
        }
    }

    const admission =
        typeof traceEvents === 'string'
            ? ({ status: 'refused', reason: traceEvents } satisfies TraceAdmission)
            : admitOfflineAudioWorkletTrace({ events: traceEvents, dataLossOccurred: completion.dataLossOccurred });
    const receipt = producerResult?.receipt;
    const summary = {
        claim: 'synthetic native OfflineAudioWorklet trace instrument admission only',
        browser: version,
        protocolVersion: version.protocolVersion,
        traceConfiguration: TRACE_CONFIGURATION,
        supportedTraceCategories: categories.categories.filter((category) => TRACE_CATEGORIES.includes(category)),
        completion,
        maximumBufferUsage,
        compressedTraceBytes: captured.bytes.byteLength,
        rawTraceBytes: rawTrace?.byteLength ?? null,
        rawTraceSha256: rawTrace ? createHash('sha256').update(rawTrace).digest('hex') : null,
        captureComplete: captured.complete,
        captureFailure,
        producerFailure,
        producerResult,
        receipt,
        relevantEventCounts: typeof traceEvents === 'string' ? null : countNamedEvents(traceEvents),
        admission: summarizeAdmission(admission),
        exclusions: ['DSP cost', 'deadline compliance', 'upper-bound qualification', 'stable-Chrome qualification'],
    };
    await attachJson(testInfo, 'offline-native-trace-summary', summary);

    expect(captured.complete, 'raw trace exceeded its explicit capture bound').toBe(true);
    expect(captureFailure).toBeNull();
    expect(producerFailure).toBeNull();
    expect(completion.dataLossOccurred).toBe(false);
    expect(completion.traceFormat).toBe('json');
    expect(completion.streamCompression).toBe('gzip');
    expect(maximumBufferUsage).toBeLessThan(1);
    expect(categories.categories).toEqual(expect.arrayContaining(TRACE_CATEGORIES));
    expect(producerResult).toMatchObject({
        isSecureContext: true,
        processorErrors: 0,
        renderedFrames: TOTAL_FRAMES,
        renderedSampleMismatches: 0,
        terminalNonzeroSamples: 0,
    });
    expect(receipt).toMatchObject({
        type: 'terminal',
        callbackCount: TOTAL_CALLBACKS,
        warmupCount: OFFLINE_TRACE_PHASES.warmupCallbacks,
        measuredCount: OFFLINE_TRACE_PHASES.measuredCallbacks,
        terminalCount: OFFLINE_TRACE_PHASES.terminalCallbacks,
        frameMismatchCount: 0,
        firstFrame: 0,
        lastRenderFrame: LAST_SLOW_ORDINAL * QUANTUM_FRAMES,
        terminalFrame: TERMINAL_ORDINAL * QUANTUM_FRAMES,
        firstSlowOrdinal: FIRST_SLOW_ORDINAL,
        middleSlowOrdinal: MIDDLE_SLOW_ORDINAL,
        lastSlowOrdinal: LAST_SLOW_ORDINAL,
    });
    expect(numericMember(receipt, 'firstSlowTicks')).toBeGreaterThanOrEqual(8);
    expect(numericMember(receipt, 'middleSlowTicks')).toBeGreaterThanOrEqual(8);
    expect(numericMember(receipt, 'lastSlowTicks')).toBeGreaterThanOrEqual(8);
    expect(numericMember(receipt, 'terminalTicks')).toBeGreaterThanOrEqual(12);
    expect(
        admission.status,
        admission.status === 'refused' ? `offline native trace admission refused: ${admission.reason}` : undefined
    ).toBe('admitted');
    if (admission.status !== 'admitted') {
        throw new Error(admission.reason);
    }
    expect(admission.warmupDurationsUs).toHaveLength(OFFLINE_TRACE_PHASES.warmupCallbacks);
    expect(admission.measuredDurationsUs).toHaveLength(OFFLINE_TRACE_PHASES.measuredCallbacks);
    expect(admission.measuredDurationsUs[0]).toBeGreaterThan(6_000);
    expect(admission.measuredDurationsUs[MIDDLE_SLOW_ORDINAL - FIRST_SLOW_ORDINAL]).toBeGreaterThan(6_000);
    expect(admission.measuredDurationsUs.at(-1)).toBeGreaterThan(6_000);
    expect(admission.terminalDurationUs).toBeGreaterThan(10_000);
});
