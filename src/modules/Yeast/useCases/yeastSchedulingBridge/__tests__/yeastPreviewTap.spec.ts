import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { YeastPreviewTap, yeastPreviewTap } from '../../../engine/yeastPreviewTap';
import { yeastStore } from '../../../stores/yeastStore';
import { processYeastMidi } from '../processYeastMidi';
import { readYeastPreviewSnapshot } from '../readYeastPreviewSnapshot';
import { setYeastPreviewCaptureEnabled } from '../setYeastPreviewCaptureEnabled';

import type { MidiEvent, TransportInfo } from '../../../models/MidiEvent';
import type { YeastPreviewEvent } from '../../../models/YeastPreviewSnapshot';

const runtime = vi.hoisted(() => ({
    processTransaction: vi.fn(),
    releasePreview: vi.fn(),
}));

vi.mock('../../../engine/yeastRuntime', () => ({
    getYeastRuntimeError: () => undefined,
    getYeastRuntimeStatus: () => 'ready',
    processYeastRuntimeTransaction: runtime.processTransaction,
    releaseYeastRuntimePreview: runtime.releasePreview,
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

function previewRecord(index: number): YeastPreviewEvent {
    return {
        eventId: index,
        rackId: 'rack-a',
        routeId: 'track-a',
        trackId: 'track-a',
        projectionVersion: 1,
        phase: 'closed',
        beatTime: 4 + index * 0.01,
        durationBeats: 0.005,
        pitch: 36 + (index % 48),
        velocity: 64 + (index % 32),
        probability: null,
        realized: true,
        processorId: 'velocity-1',
        bypassed: false,
        failed: false,
    };
}

function publishPreview(records: readonly YeastPreviewEvent[], bypassed = false): void {
    yeastPreviewTap.publish({
        rackId: 'rack-a',
        routeId: 'track-a',
        trackId: 'track-a',
        captureEpoch: yeastPreviewTap.getCaptureState({ rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' })
            .captureEpoch,
        projectionVersion: 1,
        reset: false,
        records,
        provenance: [{ processorId: 'velocity-1', bypassed, failed: false, eventCount: records.length }],
        droppedEvents: 0,
    });
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
        // `rackId` names the Yeast DEVICE whose rack is processed (production
        // passes `yeastDevice.id` from scheduleMidiNotes; issue #2422 made the
        // rack per device), so the project must hold a device with that id.
        const track = createTrack({ id: 'track-a', name: 'Rack A', kind: 'midi' });
        track.devices.push({ id: 'rack-a', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} });
        trackStore.set({ ...defaultTrackState, tracks: [track], selectedTrackId: 'track-a' });
        setYeastPreviewCaptureEnabled({ rackId: 'rack-a', trackId: 'track-a', enabled: false });
        setYeastPreviewCaptureEnabled({ rackId: 'rack-a', trackId: 'track-a', enabled: true });
        setProcessorBypass(false);
    });

    afterEach(() => {
        trackStore.set(defaultTrackState);
    });

    it('publishes an ordered 512-event read-only ring without changing scheduler output or progress', async () => {
        const processed = Array.from({ length: 514 }, (_, index) => notePair(index)).flat();
        runtime.processTransaction.mockImplementationOnce(() => {
            publishPreview(Array.from({ length: 514 }, (_, index) => previewRecord(index)));
            return Promise.resolve(processed);
        });
        const previewScope = { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' };
        const storageIdentity = yeastPreviewTap.getStorageIdentity(previewScope);

        const output = await processYeastMidi({
            context: {} as BaseAudioContext,
            rackId: 'rack-a',
            trackId: 'track-a',
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });

        expect(output).toBe(processed);
        expect(output).toEqual(processed);
        expect(runtime.processTransaction).toHaveBeenCalledTimes(1);
        expect(yeastPreviewTap.getStorageIdentity(previewScope)).toBe(storageIdentity);

        const snapshot = readYeastPreviewSnapshot({ rackId: 'rack-a', trackId: 'track-a' });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.events)).toBe(true);
        expect(Object.isFrozen(snapshot.events[0])).toBe(true);
        expect(snapshot.capacity).toBe(512);
        expect(snapshot.events).toHaveLength(512);
        expect(snapshot.droppedEvents).toBe(2);
        expect(snapshot.events[0]).toEqual({
            eventId: 0,
            rackId: 'rack-a',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            phase: 'closed',
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
        expect(snapshot.events[0]).toMatchObject({
            rackId: 'rack-a',
            routeId: 'track-a',
            trackId: 'track-a',
        });
        for (let index = 0; index < snapshot.events.length; index++) {
            expect(snapshot.events[index]!.beatTime).toBeCloseTo(4 + index * 0.01, 10);
        }

        const afterReaderAdvance = notePair(600);
        runtime.processTransaction.mockImplementationOnce(() => {
            publishPreview([previewRecord(600)]);
            return Promise.resolve(afterReaderAdvance);
        });
        const nextOutput = await processYeastMidi({
            context: {} as BaseAudioContext,
            rackId: 'rack-a',
            trackId: 'track-a',
            events: [],
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });

        expect(nextOutput).toBe(afterReaderAdvance);
        expect(readYeastPreviewSnapshot({ rackId: 'rack-a', trackId: 'track-a' }).events).toHaveLength(1);
        expect(yeastPreviewTap.getStorageIdentity(previewScope)).toBe(storageIdentity);
    });

    it('keeps bypass state visible and capture disabled as a bit-for-bit no-op', async () => {
        const processed = notePair(0);
        runtime.processTransaction.mockImplementation(() => {
            publishPreview([previewRecord(0)], true);
            return Promise.resolve(processed);
        });
        setProcessorBypass(true);

        expect(
            await processYeastMidi({
                context: {} as BaseAudioContext,
                rackId: 'rack-a',
                trackId: 'track-a',
                events: [],
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).toBe(processed);
        expect(readYeastPreviewSnapshot({ rackId: 'rack-a', trackId: 'track-a' }).provenance[0]?.bypassed).toBe(true);

        const releasedEpoch = yeastPreviewTap.getCaptureState({
            rackId: 'rack-a',
            routeId: 'track-a',
            trackId: 'track-a',
        }).captureEpoch;
        runtime.releasePreview.mockClear();
        setYeastPreviewCaptureEnabled({ rackId: 'rack-a', trackId: 'track-a', enabled: false });
        expect(runtime.releasePreview).toHaveBeenCalledWith({
            rackId: 'rack-a',
            routeId: 'track-a',
            trackId: 'track-a',
            captureEpoch: releasedEpoch,
        });
        expect(
            await processYeastMidi({
                context: {} as BaseAudioContext,
                rackId: 'rack-a',
                trackId: 'track-a',
                events: [],
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).toBe(processed);
        expect(readYeastPreviewSnapshot({ rackId: 'rack-a', trackId: 'track-a' })).toMatchObject({
            events: [],
            droppedEvents: 0,
        });
    });

    it('keeps the authored-event fast path for an empty projection when exact-route capture is disabled', async () => {
        const authoredEvents = notePair(4);
        runtime.processTransaction.mockReset();
        yeastStore.set({ processors: [], uiLevel: 1 });
        setYeastPreviewCaptureEnabled({ rackId: 'rack-a', trackId: 'track-a', enabled: false });

        const output = await processYeastMidi({
            context: {} as BaseAudioContext,
            rackId: 'rack-a',
            trackId: 'track-a',
            events: authoredEvents,
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });

        expect(output).toEqual(authoredEvents);
        expect(runtime.processTransaction).not.toHaveBeenCalled();
    });

    it('round-trips an empty projection through the Worker when exact-route capture is enabled', async () => {
        const authoredEvents = notePair(5);
        yeastStore.set({ processors: [], uiLevel: 1 });
        runtime.processTransaction.mockResolvedValueOnce(authoredEvents);

        await expect(
            processYeastMidi({
                context: {} as BaseAudioContext,
                rackId: 'rack-a',
                trackId: 'track-a',
                events: authoredEvents,
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).resolves.toBe(authoredEvents);
        expect(runtime.processTransaction).toHaveBeenCalledWith(
            expect.objectContaining({ rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a', projection: [] })
        );
    });

    it('never replaces scheduler output when preview publication fails', async () => {
        const processed = notePair(0);
        runtime.processTransaction.mockImplementationOnce(() => {
            try {
                publishPreview([previewRecord(0)]);
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
            rackId: 'rack-a',
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

    it('keeps independent rack and track routes readable without advancing each other', () => {
        const tap = new YeastPreviewTap();
        const routeA = { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' };
        const routeB = { rackId: 'rack-b', routeId: 'track-b', trackId: 'track-b' };
        tap.setEnabled(routeA, true);
        tap.setEnabled(routeB, true);
        const eventA = previewRecord(1);
        const eventB: YeastPreviewEvent = {
            ...previewRecord(2),
            rackId: routeB.rackId,
            routeId: routeB.routeId,
            trackId: routeB.trackId,
        };
        tap.publish({
            ...routeA,
            captureEpoch: tap.getCaptureState(routeA).captureEpoch,
            projectionVersion: 1,
            reset: false,
            records: [{ ...eventA, rackId: routeA.rackId }],
            provenance: [],
            droppedEvents: 0,
        });
        tap.publish({
            ...routeB,
            captureEpoch: tap.getCaptureState(routeB).captureEpoch,
            projectionVersion: 1,
            reset: false,
            records: [eventB],
            provenance: [],
            droppedEvents: 0,
        });

        expect(tap.read(routeA).events).toMatchObject([{ rackId: 'rack-a', trackId: 'track-a' }]);
        expect(tap.read(routeB).events).toMatchObject([{ rackId: 'rack-b', trackId: 'track-b' }]);
        expect(tap.getStorageIdentity(routeA)).not.toBe(tap.getStorageIdentity(routeB));
    });

    it('caps aggregate preview event storage at 512 records across all enabled routes', () => {
        const tap = new YeastPreviewTap();
        const routeA = { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' };
        const routeB = { rackId: 'rack-b', routeId: 'track-b', trackId: 'track-b' };
        tap.setEnabled(routeA, true);
        tap.setEnabled(routeB, true);

        tap.publish({
            ...routeA,
            captureEpoch: tap.getCaptureState(routeA).captureEpoch,
            projectionVersion: 1,
            reset: false,
            records: Array.from({ length: 300 }, (_, index) => ({
                ...previewRecord(index),
                rackId: routeA.rackId,
                routeId: routeA.routeId,
                trackId: routeA.trackId,
            })),
            provenance: [],
            droppedEvents: 0,
        });
        tap.publish({
            ...routeB,
            captureEpoch: tap.getCaptureState(routeB).captureEpoch,
            projectionVersion: 1,
            reset: false,
            records: Array.from({ length: 300 }, (_, index) => ({
                ...previewRecord(300 + index),
                rackId: routeB.rackId,
                routeId: routeB.routeId,
                trackId: routeB.trackId,
            })),
            provenance: [],
            droppedEvents: 0,
        });

        const snapshotA = tap.read(routeA);
        const snapshotB = tap.read(routeB);
        expect(snapshotA.events).toHaveLength(300);
        expect(snapshotB.events).toHaveLength(212);
        expect(snapshotA.events.length + snapshotB.events.length).toBe(512);
        expect(snapshotB.droppedEvents).toBe(88);
    });

    it('rejects publication from a capture epoch invalidated by a rapid disable and re-enable', () => {
        const tap = new YeastPreviewTap();
        const route = { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' };
        tap.setEnabled(route, true);
        const staleCaptureEpoch = tap.getCaptureState(route).captureEpoch;

        tap.setEnabled(route, false);
        tap.setEnabled(route, true);
        tap.publish({
            ...route,
            captureEpoch: staleCaptureEpoch,
            projectionVersion: 1,
            reset: false,
            records: [previewRecord(1)],
            provenance: [],
            droppedEvents: 0,
        });

        expect(tap.read(route).events).toEqual([]);
    });

    it('rebinds a shared route to one authoritative track scope and rejects stale publication', () => {
        const tap = new YeastPreviewTap();
        const routeA = { rackId: 'rack-a', routeId: 'shared-route', trackId: 'track-a' };
        const routeB = { rackId: 'rack-a', routeId: 'shared-route', trackId: 'track-b' };
        tap.setEnabled(routeA, true);
        const staleEpoch = tap.getCaptureState(routeA).captureEpoch;
        tap.publish({
            ...routeA,
            captureEpoch: staleEpoch,
            projectionVersion: 1,
            reset: false,
            records: [{ ...previewRecord(1), routeId: routeA.routeId }],
            provenance: [],
            droppedEvents: 0,
        });

        tap.setEnabled(routeB, true);
        const currentEpoch = tap.getCaptureState(routeB).captureEpoch;
        expect(currentEpoch).toBeGreaterThan(staleEpoch);
        tap.publish({
            ...routeA,
            captureEpoch: staleEpoch,
            projectionVersion: 1,
            reset: false,
            records: [{ ...previewRecord(2), routeId: routeA.routeId }],
            provenance: [],
            droppedEvents: 0,
        });
        const recordB = {
            ...previewRecord(3),
            routeId: routeB.routeId,
            trackId: routeB.trackId,
            pitch: 67,
        };
        tap.publish({
            ...routeB,
            captureEpoch: currentEpoch,
            projectionVersion: 1,
            reset: false,
            records: [recordB],
            provenance: [],
            droppedEvents: 0,
        });

        expect(tap.getCaptureState(routeA)).toEqual({ enabled: false, captureEpoch: 0 });
        expect(tap.getStorageIdentity(routeA)).toBeUndefined();
        expect(tap.read(routeA)).toMatchObject({ ...routeA, events: [] });
        expect(tap.read(routeB)).toMatchObject({
            ...routeB,
            events: [expect.objectContaining({ trackId: routeB.trackId, pitch: 67 })],
        });
    });

    it('rejects stale-track reads and disables without mutating a rebound route', () => {
        const tap = new YeastPreviewTap();
        const stale = { rackId: 'rack-a', routeId: 'shared-route', trackId: 'track-a' };
        const current = { ...stale, trackId: 'track-b' };
        tap.setEnabled(stale, true);
        tap.setEnabled(current, true);
        const currentEpoch = tap.getCaptureState(current).captureEpoch;
        tap.publish({
            ...current,
            captureEpoch: currentEpoch,
            projectionVersion: 1,
            reset: false,
            records: [{ ...previewRecord(1), routeId: current.routeId, trackId: current.trackId }],
            provenance: [],
            droppedEvents: 0,
        });

        expect(tap.read(stale).events).toEqual([]);
        tap.setEnabled(stale, false);

        expect(tap.getCaptureState(current)).toEqual({ enabled: true, captureEpoch: currentEpoch });
        expect(tap.read(current).events).toMatchObject([{ trackId: 'track-b' }]);
    });

    it('resets one enabled route with a new epoch and an empty reset notification', () => {
        const tap = new YeastPreviewTap();
        const route = { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' };
        tap.setEnabled(route, true);
        const staleEpoch = tap.getCaptureState(route).captureEpoch;
        tap.publish({
            ...route,
            captureEpoch: staleEpoch,
            projectionVersion: 1,
            reset: false,
            records: [previewRecord(1)],
            provenance: [],
            droppedEvents: 0,
        });

        const released = tap.reset(route);
        const currentEpoch = tap.getCaptureState(route).captureEpoch;
        tap.publish({
            ...route,
            captureEpoch: staleEpoch,
            projectionVersion: 1,
            reset: false,
            records: [previewRecord(2)],
            provenance: [],
            droppedEvents: 0,
        });

        expect(released).toEqual({ ...route, captureEpoch: staleEpoch });
        expect(currentEpoch).toBeGreaterThan(staleEpoch);
        expect(tap.read(route)).toMatchObject({ ...route, events: [], reset: true, droppedEvents: 0 });
    });

    it('copies and freezes provenance entries at the snapshot boundary', () => {
        const tap = new YeastPreviewTap();
        const route = { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' };
        const provenance = { processorId: 'velocity-1', bypassed: false, failed: false, eventCount: 1 };
        tap.setEnabled(route, true);
        tap.publish({
            ...route,
            captureEpoch: tap.getCaptureState(route).captureEpoch,
            projectionVersion: 1,
            reset: false,
            records: [previewRecord(1)],
            provenance: [provenance],
            droppedEvents: 0,
        });

        const snapshot = tap.read(route);
        provenance.bypassed = true;
        provenance.eventCount = 99;

        expect(snapshot.provenance[0]).toEqual({
            processorId: 'velocity-1',
            bypassed: false,
            failed: false,
            eventCount: 1,
        });
        expect(Object.isFrozen(snapshot.provenance[0])).toBe(true);
    });
});
