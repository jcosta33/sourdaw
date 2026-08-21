import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { setActiveYeastDevice, yeastStore } from '../../stores/yeastStore';
import { createOfflineYeastMidiProcessor } from '../createOfflineYeastMidiProcessor';

const ppqOf = ({ samples, sampleRate }: { samples: number; sampleRate: number }) => samples / (sampleRate * 0.5);
const musicalPosition = () => ({
    bpm: 120,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
});

// Offline rendering resolves each track's rack through the Yeast device that
// lives on that track (issue #2422), so a track only has a rack when the
// project holds its device — the seeds below give each test its track.
function seedYeastTrack(trackId: string, deviceId: string): void {
    const track = createTrack({ id: trackId, name: trackId, kind: 'midi' });
    track.devices.push({ id: deviceId, name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} });
    trackStore.set({ ...defaultTrackState, tracks: [track], selectedTrackId: trackId });
}

describe('createOfflineYeastMidiProcessor', () => {
    beforeEach(() => {
        seedYeastTrack('track-a', 'device-a');
        yeastStore.set({
            uiLevel: 1,
            processors: [
                {
                    id: 'transpose',
                    type: 'transposer',
                    name: 'Transposer',
                    bypassed: false,
                    params: { semitones: 12 },
                },
            ],
        });
    });

    afterEach(() => {
        // Restore a valid default so a null store never leaks across suites.
        yeastStore.set({ uiLevel: 1, processors: [] });
        setActiveYeastDevice(null);
        trackStore.set(defaultTrackState);
    });

    it('resolves a track rack once per render and stays deterministic after live state changes', () => {
        const processSnapshot = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ppqOf,
            resolveMusicalPosition: musicalPosition,
        });
        const events = [
            {
                timeSamples: 24_000,
                timePpq: 1,
                trackId: 'track-a',
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
            {
                timeSamples: 48_000,
                timePpq: 2,
                trackId: 'track-a',
                kind: { type: 'noteOff' as const, channel: 0, note: 60 },
            },
        ];

        const first = processSnapshot({
            trackId: 'track-a',
            sampleRate: 48_000,
            blockStartSamples: 0,
            blockEndSamples: 96_000,
            events: structuredClone(events),
        });
        yeastStore.set({ uiLevel: 1, processors: [] });
        const second = processSnapshot({
            trackId: 'track-a',
            sampleRate: 48_000,
            blockStartSamples: 0,
            blockEndSamples: 96_000,
            events: structuredClone(events),
        });

        expect(first.map((event) => event.kind)).toEqual([
            { type: 'noteOn', channel: 0, note: 72, velocity: 100 },
            { type: 'noteOff', channel: 0, note: 72 },
        ]);
        expect(second).toEqual(first);
    });

    it('drives transport generators through chronological playing blocks', () => {
        seedYeastTrack('track-generator', 'device-generator');
        yeastStore.set({
            uiLevel: 1,
            processors: [
                {
                    id: 'euclid',
                    type: 'euclidean',
                    name: 'Euclidean',
                    bypassed: false,
                    params: { hits: 1, steps: 1, rate_denom: 16, note: 64 },
                },
            ],
        });
        const visitedPpq: number[] = [];
        const processSnapshot = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ppqOf,
            resolveMusicalPosition: (ppqPosition) => {
                visitedPpq.push(ppqPosition);
                return { ...musicalPosition(), beatInBar: ppqPosition };
            },
        });

        const output = processSnapshot({
            trackId: 'track-generator',
            sampleRate: 48_000,
            blockStartSamples: 0,
            blockEndSamples: 7_000,
            events: [],
        });

        expect(output.some((event) => event.kind.type === 'noteOn')).toBe(true);
        expect(output.every((event) => Number.isFinite(event.timePpq))).toBe(true);
        expect(visitedPpq.length).toBeGreaterThan(1);
        expect(visitedPpq[1]).toBeGreaterThan(visitedPpq[0]!);
    });

    it('releases a voice at the render boundary when its source note-off lies beyond it', () => {
        // Seed first, THEN author the rack: the device-switch projection a
        // re-seed triggers replaces any still-unflushed un-pinned rack value,
        // so the rack must be written while the test's own device is active.
        seedYeastTrack('track-tail', 'device-tail');
        yeastStore.set({
            uiLevel: 1,
            processors: [
                {
                    id: 'transpose',
                    type: 'transposer',
                    name: 'Transposer',
                    bypassed: false,
                    params: { semitones: 12 },
                },
            ],
        });
        const processSnapshot = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ({ samples }) => samples / 100,
            resolveMusicalPosition: musicalPosition,
        });

        const output = processSnapshot({
            trackId: 'track-tail',
            sampleRate: 48_000,
            blockStartSamples: 0,
            blockEndSamples: 200,
            events: [
                {
                    timeSamples: 100,
                    timePpq: 1,
                    trackId: 'track-tail',
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
                {
                    timeSamples: 500,
                    timePpq: 5,
                    trackId: 'track-tail',
                    kind: { type: 'noteOff', channel: 0, note: 60 },
                },
            ],
        });

        expect(output.map((event) => ({ timeSamples: event.timeSamples, kind: event.kind }))).toEqual([
            { timeSamples: 100, kind: { type: 'noteOn', channel: 0, note: 72, velocity: 100 } },
            { timeSamples: 200, kind: { type: 'noteOff', channel: 0, note: 72 } },
        ]);
    });

    it('preserves source routes while delayed processor output crosses offline blocks', () => {
        const processSnapshot = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ppqOf,
            resolveMusicalPosition: musicalPosition,
            processors: [
                {
                    id: 'repeat',
                    type: 'repeater',
                    name: 'Repeater',
                    bypassed: false,
                    params: { repeat_count: 1, rate_denom: 16 },
                },
            ],
        });

        const output = processSnapshot({
            trackId: 'track-a',
            sampleRate: 48_000,
            blockStartSamples: 0,
            blockEndSamples: 7_000,
            events: [
                {
                    timeSamples: 0,
                    timePpq: 0,
                    trackId: 'clip-route-a',
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
                {
                    timeSamples: 100,
                    timePpq: 100 / 24_000,
                    trackId: 'clip-route-a',
                    kind: { type: 'noteOff', channel: 0, note: 60 },
                },
            ],
        });
        const routedNotes = output.filter((event) => event.kind.type === 'noteOn' || event.kind.type === 'noteOff');

        expect(routedNotes.some((event) => event.timeSamples > 128)).toBe(true);
        expect(routedNotes.every((event) => event.trackId === 'clip-route-a')).toBe(true);
    });

    it('builds an empty rack from an unhydrated (null) store and passes events through unchanged', () => {
        // No explicit processors + a null store must still produce a valid
        // offline processor over an empty rack, rather than throw.
        yeastStore.set(null);
        const processSnapshot = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ppqOf,
            resolveMusicalPosition: musicalPosition,
        });

        const output = processSnapshot({
            trackId: 'track-a',
            sampleRate: 48_000,
            blockStartSamples: 0,
            blockEndSamples: 96_000,
            events: [
                {
                    timeSamples: 0,
                    timePpq: 0,
                    trackId: 'track-a',
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
            ],
        });

        expect(output.map((event) => event.kind)).toEqual([{ type: 'noteOn', channel: 0, note: 60, velocity: 100 }]);
    });

    it('renders each track through its own device rack, not the active one', () => {
        // Two Yeast devices, two racks (issue #2422): an offline render spans
        // every track, so each track's notes must run through the rack of the
        // device on THAT track. Reverted to a single active-rack snapshot,
        // both tracks would go through one rack and one pitch would be wrong.
        let document = from({}) as Doc<{ yeast?: unknown }>;
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        try {
            const firstTrack = createTrack({ id: 'track-a', name: 'track-a', kind: 'midi' });
            firstTrack.devices.push({
                id: 'device-a',
                name: 'Yeast',
                type: 'yeast',
                bypassed: false,
                parameterValues: {},
            });
            const secondTrack = createTrack({ id: 'track-b', name: 'track-b', kind: 'midi' });
            secondTrack.devices.push({
                id: 'device-b',
                name: 'Yeast',
                type: 'yeast',
                bypassed: false,
                parameterValues: {},
            });
            trackStore.set({
                ...defaultTrackState,
                tracks: [firstTrack, secondTrack],
                selectedTrackId: 'track-a',
            });

            const transpose = (id: string, semitones: number) => ({
                id,
                type: 'transposer' as const,
                name: 'Transposer',
                bypassed: false,
                params: { semitones },
            });
            setActiveYeastDevice('device-a');
            yeastStore.set({ uiLevel: 1, processors: [transpose('up', 12)] });
            setActiveYeastDevice('device-b');
            yeastStore.set({ uiLevel: 1, processors: [transpose('down', -12)] });
            flushAutomergeStorageWrites();

            const processSnapshot = createOfflineYeastMidiProcessor({
                resolvePpqPosition: ppqOf,
                resolveMusicalPosition: musicalPosition,
            });
            const notePair = (trackId: string) => [
                {
                    timeSamples: 0,
                    timePpq: 0,
                    trackId,
                    kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
                },
                {
                    timeSamples: 24_000,
                    timePpq: 1,
                    trackId,
                    kind: { type: 'noteOff' as const, channel: 0, note: 60 },
                },
            ];
            const renderTrack = (trackId: string): number[] =>
                processSnapshot({
                    trackId,
                    sampleRate: 48_000,
                    blockStartSamples: 0,
                    blockEndSamples: 48_000,
                    events: notePair(trackId),
                }).flatMap((event) => (event.kind.type === 'noteOn' ? [event.kind.note] : []));

            // device-a racks +12, device-b racks -12; the active device at
            // render time is device-b (last pinned), so a shared active-rack
            // snapshot would transpose BOTH tracks down.
            expect(renderTrack('track-a')).toEqual([72]);
            expect(renderTrack('track-b')).toEqual([48]);
        } finally {
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
        }
    });
});
