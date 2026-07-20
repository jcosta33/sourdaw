import { beforeEach, describe, expect, it } from 'vitest';

import { yeastStore } from '../../stores/yeastStore';
import { createOfflineYeastMidiProcessor } from '../createOfflineYeastMidiProcessor';

describe('createOfflineYeastMidiProcessor', () => {
    beforeEach(() => {
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

    it('should execute a deterministic processor snapshot after live state changes', () => {
        const processSnapshot = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ({ samples, sampleRate }) => samples / (sampleRate * 0.5),
            resolveMusicalPosition: () => ({
                bpm: 120,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            }),
        });
        yeastStore.set({ uiLevel: 1, processors: [] });
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
            resolvePpqPosition: ({ samples, sampleRate }) => samples / (sampleRate * 0.5),
            resolveMusicalPosition: (ppqPosition) => {
                visitedPpq.push(ppqPosition);
                return {
                    bpm: 120,
                    barIndex: 0,
                    beatInBar: ppqPosition,
                    timeSigNum: 4,
                    timeSigDen: 4,
                    loopEnabled: false,
                    loopStartPpq: 0,
                    loopEndPpq: 0,
                };
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
        const processSnapshot = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ({ samples }) => samples / 100,
            resolveMusicalPosition: () => ({
                bpm: 120,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            }),
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
            resolvePpqPosition: ({ samples, sampleRate }) => samples / (sampleRate * 0.5),
            resolveMusicalPosition: () => ({
                bpm: 120,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            }),
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
});
