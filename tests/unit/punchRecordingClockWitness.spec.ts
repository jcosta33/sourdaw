import type { Page } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    captureFrameDrift,
    installPunchRecordingClockWitness,
    RECORDING_RENDER_QUANTUM_FRAMES,
} from '../e2e/punchRecordingClockWitness';

const SAMPLE_ZERO = 240_000;
const SAMPLE_RATE = 48_000;
const INITIAL_FRAMES = 1280;
const nativeAtomics = Atomics;

class TestPort {
    sent: unknown[] = [];
    listeners: ((event: MessageEvent<unknown>) => void)[] = [];

    postMessage(message: unknown): void {
        this.sent.push(message);
    }

    addEventListener(_kind: string, listener: (event: MessageEvent<unknown>) => void): void {
        this.listeners.push(listener);
    }

    dispatch(data: unknown): void {
        for (const listener of this.listeners) {
            listener(new MessageEvent('message', { data }));
        }
    }
}

class TestRecordingNode {
    port = new TestPort();

    constructor(readonly context: { sampleRate: number; currentTime: number }) {}
}

class TestWorker {
    postMessage(): void {}
    addEventListener(): void {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function witnessField(name: string): unknown {
    const state: unknown = Reflect.get(window, '__punchRecordingClockWitness');
    if (!isRecord(state)) {
        throw new TypeError('The actual installer did not retain its witness');
    }
    return state[name];
}

function readFrame(): Parameters<typeof captureFrameDrift>[0] {
    const read: unknown = Reflect.get(window, '__readPunchRecordingClock');
    if (typeof read !== 'function') {
        throw new TypeError('The actual installer did not expose its observation');
    }
    const observation: unknown = Reflect.apply(read, window, []);
    const frame = isRecord(observation) ? observation.recording : null;
    if (
        !isRecord(frame) ||
        typeof frame.contextFrame !== 'number' ||
        typeof frame.sampleRate !== 'number' ||
        typeof frame.publishedFrames !== 'number' ||
        (frame.sampleZeroContextFrame !== null && typeof frame.sampleZeroContextFrame !== 'number')
    ) {
        throw new TypeError('The installed observer returned no complete recording frame');
    }
    return {
        contextFrame: frame.contextFrame,
        sampleRate: frame.sampleRate,
        publishedFrames: frame.publishedFrames,
        sampleZeroContextFrame: frame.sampleZeroContextFrame,
    };
}

async function installFixture() {
    const sab = new SharedArrayBuffer((6 + 2048) * Int32Array.BYTES_PER_ELEMENT);
    const control = new Int32Array(sab, 0, 6);
    const pcm = new Float32Array(sab, 6 * Int32Array.BYTES_PER_ELEMENT);
    let capturedFrames = 0;
    let contextFrame = SAMPLE_ZERO;
    let payloadRead = false;
    let onClockRead: (() => void) | null = null;
    let clockReads = 0;

    function publishBlock(): void {
        nativeAtomics.add(control, 0, 1);
        if (capturedFrames === 0) {
            nativeAtomics.store(control, 3, SAMPLE_ZERO);
            nativeAtomics.store(control, 5, 1);
        }
        for (let offset = 0; offset < 128; offset++) {
            pcm[capturedFrames + offset] = (capturedFrames + offset) / 2048;
        }
        capturedFrames += 128;
        nativeAtomics.store(control, 1, capturedFrames);
        nativeAtomics.add(control, 0, 1);
        contextFrame = SAMPLE_ZERO + capturedFrames;
    }

    for (let block = 0; block < INITIAL_FRAMES / 128; block++) {
        publishBlock();
    }
    const context = {
        sampleRate: SAMPLE_RATE,
        get currentTime() {
            clockReads++;
            onClockRead?.();
            return contextFrame / SAMPLE_RATE;
        },
    };
    vi.stubGlobal('AudioWorkletNode', TestRecordingNode);
    vi.stubGlobal('Worker', TestWorker);
    const page: Pick<Page, 'addInitScript'> = {
        async addInitScript(script) {
            if (typeof script !== 'function') {
                throw new TypeError('The fixture must execute the actual init callback');
            }
            Reflect.apply(script, undefined, []);
        },
    };
    await installPunchRecordingClockWitness(page);
    const node: unknown = Reflect.construct(window.AudioWorkletNode, [context, 'recording-processor']);
    if (!(node instanceof TestRecordingNode)) {
        throw new TypeError('The real installer did not construct the recording host');
    }
    node.port.postMessage({ type: 'init', sab });
    vi.stubGlobal('Atomics', {
        load(array: Int32Array, index: number): number {
            const value = nativeAtomics.load(array, index);
            if (array.buffer === sab && index === 1) {
                payloadRead = true;
            }
            return value;
        },
    });
    return {
        control,
        pcm,
        port: node.port,
        publishBlock,
        afterPayloadRead: () => payloadRead,
        clockReads: () => clockReads,
        setClockRead(action: () => void) {
            onClockRead = action;
        },
        advanceWithoutInput(frames: number) {
            contextFrame += frames;
        },
        expectCompletePcm() {
            expect(nativeAtomics.load(control, 1)).toBe(capturedFrames);
            for (let frame = 0; frame < capturedFrames; frame++) {
                expect(pcm[frame]).toBe(frame / 2048);
            }
        },
    };
}

describe('installed punch capture clock observer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reads a coherent capture without changing its count or first frame', async () => {
        const fixture = await installFixture();
        expect(readFrame()).toEqual({
            contextFrame: SAMPLE_ZERO + INITIAL_FRAMES,
            sampleRate: SAMPLE_RATE,
            publishedFrames: INITIAL_FRAMES,
            sampleZeroContextFrame: SAMPLE_ZERO,
        });
        fixture.expectCompletePcm();
    });

    it('reobserves complete publications between its ring payload and context clock', async () => {
        const fixture = await installFixture();
        let injected = false;
        fixture.setClockRead(() => {
            if (fixture.afterPayloadRead() && !injected) {
                injected = true;
                fixture.publishBlock();
                fixture.publishBlock();
            }
        });
        const frame = readFrame();
        expect(injected).toBe(true);
        fixture.expectCompletePcm();
        expect(frame.publishedFrames).toBe(INITIAL_FRAMES + 256);
        expect(frame.contextFrame).toBe(SAMPLE_ZERO + INITIAL_FRAMES + 256);
        expect(frame.sampleZeroContextFrame).toBe(SAMPLE_ZERO);
        expect(captureFrameDrift(frame)).toBe(0);
    });

    it.each([256, 1024])('retains a stable genuine %i-frame input gap for the strict oracle', async (gap) => {
        const fixture = await installFixture();
        fixture.advanceWithoutInput(gap);
        const frame = readFrame();
        expect(frame.publishedFrames).toBe(INITIAL_FRAMES);
        expect(captureFrameDrift(frame)).toBe(gap);
        expect(Math.abs(captureFrameDrift(frame)!)).toBeGreaterThan(RECORDING_RENDER_QUANTUM_FRAMES);
        fixture.expectCompletePcm();
    });

    it('reobserves a changed context even when the publication sequence stays stable', async () => {
        const fixture = await installFixture();
        let injected = false;
        fixture.setClockRead(() => {
            if (fixture.afterPayloadRead() && !injected) {
                injected = true;
                fixture.advanceWithoutInput(256);
            }
        });
        const frame = readFrame();
        expect(injected).toBe(true);
        expect(captureFrameDrift(frame)).toBe(256);
        expect(witnessField('readDiagnostics')).toEqual({
            unstableAttempts: 1,
            exhaustedReads: 0,
            recentUnstableAttempts: [
                {
                    contextFrameBefore: SAMPLE_ZERO + INITIAL_FRAMES,
                    contextFrameAfter: SAMPLE_ZERO + INITIAL_FRAMES + 256,
                    sequenceBefore: 20,
                    sequenceAfter: 20,
                },
            ],
        });
    });

    it('reobserves a completed publication even when the reported context frame stays stable', async () => {
        const fixture = await installFixture();
        let injected = false;
        fixture.setClockRead(() => {
            if (fixture.afterPayloadRead() && !injected) {
                injected = true;
                fixture.publishBlock();
                fixture.advanceWithoutInput(-128);
            }
        });
        const frame = readFrame();
        expect(injected).toBe(true);
        expect(frame.publishedFrames).toBe(INITIAL_FRAMES + 128);
        expect(captureFrameDrift(frame)).toBe(-128);
        expect(witnessField('readDiagnostics')).toEqual({
            unstableAttempts: 1,
            exhaustedReads: 0,
            recentUnstableAttempts: [
                {
                    contextFrameBefore: SAMPLE_ZERO + INITIAL_FRAMES,
                    contextFrameAfter: SAMPLE_ZERO + INITIAL_FRAMES,
                    sequenceBefore: 20,
                    sequenceAfter: 22,
                },
            ],
        });
        fixture.expectCompletePcm();
    });

    it('bounds persistent instability without fabricating a sample or losing the failed-read count', async () => {
        const fixture = await installFixture();
        fixture.setClockRead(() => fixture.advanceWithoutInput(128));
        expect(() => readFrame()).toThrow('no complete recording frame');
        expect(fixture.clockReads()).toBe(16);
        vi.advanceTimersByTime(50);
        expect(fixture.clockReads()).toBe(32);
        expect(witnessField('samples')).toEqual([]);
        const diagnostics = witnessField('readDiagnostics');
        expect(diagnostics).toMatchObject({ unstableAttempts: 16, exhaustedReads: 2 });
        expect(isRecord(diagnostics) && diagnostics.recentUnstableAttempts).toHaveLength(16);
    });

    it('keeps Stop and the final producer acknowledgement after periodic observations cease', async () => {
        const fixture = await installFixture();
        vi.advanceTimersByTime(50);
        expect(witnessField('samples')).toHaveLength(1);
        fixture.port.postMessage({ type: 'stop' });
        fixture.advanceWithoutInput(1024);
        vi.advanceTimersByTime(100);
        fixture.port.dispatch({ type: 'stopped', publishedSampleCount: INITIAL_FRAMES });
        expect(witnessField('samples')).toHaveLength(1);
        expect(witnessField('events')).toEqual([
            expect.objectContaining({
                kind: 'send-worklet-stop',
                recording: expect.objectContaining({
                    contextFrame: SAMPLE_ZERO + INITIAL_FRAMES,
                    publishedFrames: INITIAL_FRAMES,
                    sampleZeroContextFrame: SAMPLE_ZERO,
                }),
            }),
            expect.objectContaining({ kind: 'worklet-stopped-ack', publishedFrames: INITIAL_FRAMES }),
        ]);
        expect(fixture.port.sent).toEqual([expect.objectContaining({ type: 'init' }), { type: 'stop' }]);
        fixture.expectCompletePcm();
    });
});
