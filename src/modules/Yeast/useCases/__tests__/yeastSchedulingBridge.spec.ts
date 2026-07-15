import { beforeEach, describe, expect, it } from 'vitest';

import { yeastStore } from '../../stores/yeastStore';
import { processYeastMidi } from '../yeastSchedulingBridge/processYeastMidi';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';

const transport: TransportInfo = {
    sampleRate: 48000,
    bpm: 120,
    ppqPosition: 0,
    isPlaying: true,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

describe('processYeastMidi', () => {
    beforeEach(() => {
        yeastStore.set({ processors: [], uiLevel: 1 });
    });

    it('passes events through when the projection has no processors', async () => {
        const events: MidiEvent[] = [
            {
                timeSamples: 0,
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            },
        ];

        const out = await processYeastMidi({
            context: {} as BaseAudioContext,
            trackId: 'track-a',
            events,
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });

        expect(out).toEqual(events);
    });
});
