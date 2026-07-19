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

    it('executes a deterministic processor snapshot after live state changes', () => {
        const processSnapshot = createOfflineYeastMidiProcessor({
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
                sourceEventId: 'note-a:on',
                noteInstanceId: 'note-a',
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
            {
                timeSamples: 48_000,
                timePpq: 2,
                trackId: 'track-a',
                sourceEventId: 'note-a:off',
                noteInstanceId: 'note-a',
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
        const secondProcessor = createOfflineYeastMidiProcessor({
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
                    id: 'transpose',
                    type: 'transposer',
                    name: 'Transposer',
                    bypassed: false,
                    params: { semitones: 12 },
                },
            ],
        });
        const second = secondProcessor({
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
});
