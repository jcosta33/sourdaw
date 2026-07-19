import { beforeEach, describe, expect, it, vi } from 'vitest';

import { yeastPreviewTap } from '../../../engine/yeastPreviewTap';
import { yeastStore } from '../../../stores/yeastStore';
import { processYeastMidi } from '../processYeastMidi';
import { readYeastPreviewSnapshot } from '../readYeastPreviewSnapshot';
import { setYeastPreviewCaptureEnabled } from '../setYeastPreviewCaptureEnabled';

import type { MidiEvent, TransportInfo } from '../../../models/MidiEvent';
import type { YeastPreviewEvent } from '../../../models/YeastPreviewSnapshot';

const runtime = vi.hoisted(() => ({
    processTransaction: vi.fn(),
}));

vi.mock('../../../engine/yeastRuntime', () => ({
    getYeastRuntimeError: () => undefined,
    getYeastRuntimeStatus: () => 'ready',
    processYeastRuntimeTransaction: runtime.processTransaction,
}));

const transport: TransportInfo = {
    sampleRate: 48000,
    bpm: 120,
    ppqPosition: 4,
    isPlaying: true,
    barIndex: 1,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

function notePair(index: number): MidiEvent[] {
    const timeSamples = index * 240;
    return [
        {
            timeSamples,
            trackId: 'track-a',
            kind: { type: 'noteOn', channel: 0, note: 36 + (index % 48), velocity: 64 + (index % 32) },
        },
        {
            timeSamples: timeSamples + 120,
            trackId: 'track-a',
            kind: { type: 'noteOff', channel: 0, note: 36 + (index % 48) },
        },
    ];
}

function previewRecord(index: number, bypassed = false): YeastPreviewEvent {
    return {
        beatTime: 4 + index * 0.01,
        durationBeats: 0.005,
        pitch: 36 + (index % 48),
        velocity: 64 + (index % 32),
        probability: null,
        realized: true,
        processorId: 'velocity-1',
        bypassed,
        failed: false,
    };
}

function setProcessorBypass(bypassed: boolean): void {
    yeastStore.set({
        processors: [
            {
                id: 'velocity-1',
                type: 'velocity',
                name: 'Velocity',
                bypassed,
                params: {},
            },
        ],
        uiLevel: 1,
    });
}

describe('AC-001 — Yeast scheduled-event preview tap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setYeastPreviewCaptureEnabled(false);
        setYeastPreviewCaptureEnabled(true);
        setProcessorBypass(false);
    });

    it('publishes an ordered 512-event read-only ring without changing scheduler output or progress', async () => {
        const processed = Array.from({ length: 514 }, (_, index) => notePair(index)).flat();
        runtime.processTransaction.mockImplementationOnce(() => {
            yeastPreviewTap.publish({
                records: Array.from({ length: 514 }, (_, index) => previewRecord(index)),
                droppedEvents: 0,
            });
            return Promise.resolve(processed);
        });
        const storageIdentity = yeastPreviewTap.getStorageIdentity();

        const output = await processYeastMidi({
            context: {} as BaseAudioContext,
            trackId: 'track-a',
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });

        expect(output).toBe(processed);
        expect(output).toEqual(processed);
        expect(runtime.processTransaction).toHaveBeenCalledTimes(1);
        expect(yeastPreviewTap.getStorageIdentity()).toBe(storageIdentity);

        const snapshot = readYeastPreviewSnapshot();
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.events)).toBe(true);
        expect(Object.isFrozen(snapshot.events[0])).toBe(true);
        expect(snapshot.capacity).toBe(512);
        expect(snapshot.events).toHaveLength(512);
        expect(snapshot.droppedEvents).toBe(2);
        expect(snapshot.events[0]).toEqual({
            beatTime: 4,
            durationBeats: 0.005,
            pitch: 36,
            velocity: 64,
            probability: null,
            realized: true,
            processorId: 'velocity-1',
            bypassed: false,
            failed: false,
        });
        for (let index = 0; index < snapshot.events.length; index++) {
            expect(snapshot.events[index]!.beatTime).toBeCloseTo(4 + index * 0.01, 10);
        }

        const afterReaderAdvance = notePair(600);
        runtime.processTransaction.mockImplementationOnce(() => {
            yeastPreviewTap.publish({ records: [previewRecord(600)], droppedEvents: 0 });
            return Promise.resolve(afterReaderAdvance);
        });
        const nextOutput = await processYeastMidi({
            context: {} as BaseAudioContext,
            trackId: 'track-a',
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });

        expect(nextOutput).toBe(afterReaderAdvance);
        expect(readYeastPreviewSnapshot().events).toHaveLength(1);
        expect(yeastPreviewTap.getStorageIdentity()).toBe(storageIdentity);
    });

    it('keeps bypass state visible and capture disabled as a bit-for-bit no-op', async () => {
        const processed = notePair(0);
        runtime.processTransaction.mockImplementation(() => {
            yeastPreviewTap.publish({ records: [previewRecord(0, true)], droppedEvents: 0 });
            return Promise.resolve(processed);
        });
        setProcessorBypass(true);

        expect(
            await processYeastMidi({
                context: {} as BaseAudioContext,
                trackId: 'track-a',
                events: [],
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).toBe(processed);
        expect(readYeastPreviewSnapshot().events[0]?.bypassed).toBe(true);

        setYeastPreviewCaptureEnabled(false);
        expect(
            await processYeastMidi({
                context: {} as BaseAudioContext,
                trackId: 'track-a',
                events: [],
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).toBe(processed);
        expect(readYeastPreviewSnapshot()).toMatchObject({ events: [], droppedEvents: 0 });
    });

    it('never replaces scheduler output when preview publication fails', async () => {
        const processed = notePair(0);
        runtime.processTransaction.mockImplementationOnce(() => {
            try {
                yeastPreviewTap.publish({ records: [previewRecord(0)], droppedEvents: 0 });
            } catch {
                // Mirrors the runtime's observer isolation.
            }
            return Promise.resolve(processed);
        });
        const previewFailure = vi.spyOn(yeastPreviewTap, 'publish').mockImplementationOnce(() => {
            throw new Error('preview unavailable');
        });

        const output = await processYeastMidi({
            context: {} as BaseAudioContext,
            trackId: 'track-a',
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });

        expect(output).toBe(processed);
        expect(output).toEqual(processed);
        previewFailure.mockRestore();
    });
});
