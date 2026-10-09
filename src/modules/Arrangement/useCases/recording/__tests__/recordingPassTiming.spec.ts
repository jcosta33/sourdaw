import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Take } from '../../../models/TakeLane';
import { recordingPassTiming } from '../recordingPassTiming';

const clock = vi.hoisted(() => ({
    beat: 10,
    audioTimeSeconds: 51,
    tempo: 120,
    isPlaying: true,
}));
vi.mock('#/modules/Transport/stores', () => ({
    playheadClockRef: clock,
    transportStore: {
        get value() {
            return { isPlaying: clock.isPlaying, loopStart: 8, loopEnd: 12 };
        },
    },
    readSecondsAtBeat: ({ beat }: { beat: number }) => (beat * 60) / clock.tempo,
    readTempoAtBeat: () => clock.tempo,
    readBeatAtSamples: ({ samples }: { samples: number }) => (samples * clock.tempo) / 60,
}));

function pass(id: string, clipId = 'capture', depth = 0): Take {
    return { id, clipId, name: id, startBeat: 8, endBeat: 12, selected: false, sourceOffsetBeats: depth };
}

describe('recording pass capture-clock witnesses', () => {
    beforeEach(() => {
        recordingPassTiming.retire('capture');
        recordingPassTiming.retire('successor');
        Object.assign(clock, { beat: 10, audioTimeSeconds: 51, tempo: 120, isPlaying: true });
    });

    it('keeps the first partial pass and later passes on their physical seams after tempo edits', () => {
        recordingPassTiming.begin('capture', 10);
        const first = pass('first');
        const second = pass('second', 'capture', 2);
        recordingPassTiming.stage(first, 52);
        clock.tempo = 60;
        recordingPassTiming.stage(second, 56);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 4.9)).toBeCloseTo(0.1, 10);
        expect(recordingPassTiming.depthSeconds(second, 50.9, 4.9)).toBeCloseTo(1.1, 10);
    });

    it('keeps the run-up out of the first loop pass', () => {
        clock.beat = 6;
        clock.audioTimeSeconds = 50;
        recordingPassTiming.begin('capture', 6);
        const first = pass('first', 'capture', 2);
        recordingPassTiming.stage(first, 53);
        expect(recordingPassTiming.depthSeconds(first, 49.9, 2.9)).toBeCloseTo(1.1, 10);
    });

    it('anchors a stopped start to the actual rolling clock after a hold and tempo edit', () => {
        clock.isPlaying = false;
        let firstPassContextSeconds: number | null = null;
        recordingPassTiming.begin('capture', 10, () => firstPassContextSeconds);
        clock.tempo = 60;
        firstPassContextSeconds = 54;
        const first = pass('first');
        recordingPassTiming.stage(first, 56);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 4.9)).toBeCloseTo(3.1, 10);
    });

    it('freezes musical-only staging before capture completion changes the map', () => {
        recordingPassTiming.begin('capture', 10);
        const second = pass('second', 'capture', 2);
        recordingPassTiming.stage(second);
        clock.tempo = 60;
        expect(recordingPassTiming.depthSeconds(second, 50.9, 4.9)).toBeCloseTo(1.1, 10);
    });

    it('retires only the discarded capture and refuses its stale source read', () => {
        recordingPassTiming.begin('capture', 10);
        const old = pass('old');
        recordingPassTiming.stage(old, 52);
        clock.audioTimeSeconds = 60;
        recordingPassTiming.begin('successor', 10);
        const next = pass('next', 'successor');
        recordingPassTiming.stage(next, 61);
        recordingPassTiming.retire('capture');
        recordingPassTiming.retire('capture');
        expect(() => recordingPassTiming.depthSeconds(old, 50.9, 4.9)).toThrow(
            'Recording pass has no captured source timing'
        );
        expect(recordingPassTiming.depthSeconds(next, 59.9, 4.9)).toBeCloseTo(0.1, 10);
    });
});
