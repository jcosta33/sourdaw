import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Take } from '../../../models/TakeLane';
import { recordingPassTiming } from '../recordingPassTiming';

const clock = vi.hoisted(() => ({
    beat: 10,
    audioTimeSeconds: 51,
    tempo: 120,
    isPlaying: true,
    loopStart: 8,
}));
vi.mock('#/modules/Transport/stores', () => ({
    playheadClockRef: clock,
    transportStore: {
        get value() {
            return { isPlaying: clock.isPlaying, loopStart: clock.loopStart, loopEnd: 12 };
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
        Object.assign(clock, { beat: 10, audioTimeSeconds: 51, tempo: 120, isPlaying: true, loopStart: 8 });
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
        recordingPassTiming.observeEntry(['capture'], 8, 51, false);
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

    it('keeps an actual entry after a run-up tempo edit', () => {
        clock.beat = 6;
        recordingPassTiming.begin('capture', 6);
        clock.tempo = 60;
        recordingPassTiming.observeEntry(['capture'], 8, 53, false);
        const first = pass('first', 'capture', 2);
        recordingPassTiming.stage(first, 57);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 2.9)).toBeCloseTo(2.1, 10);
        clock.tempo = 120;
        expect(recordingPassTiming.depthSeconds(first, 50.9, 2.9)).toBeCloseTo(2.1, 10);
    });

    it('observes the moved loop entry after a loop-bound edit during run-up', () => {
        clock.beat = 6;
        recordingPassTiming.begin('capture', 6);
        clock.tempo = 60;
        clock.loopStart = 10;
        recordingPassTiming.observeEntry(['capture'], 8, 53, false);
        recordingPassTiming.observeEntry(['capture'], 10, 55, false);
        const first = pass('first', 'capture', 4);
        recordingPassTiming.stage(first, 57);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 2.9)).toBeCloseTo(4.1, 10);
    });

    it.each([10, 7])('refreshes an already observed first entry when loop start moves to %s', (entryBeat) => {
        clock.beat = 6;
        clock.audioTimeSeconds = 51;
        recordingPassTiming.begin('capture', 6);
        recordingPassTiming.observeEntry(['capture'], 8, 52, false);
        clock.loopStart = entryBeat;
        recordingPassTiming.observeEntry(['capture'], 8.5, 52.25, true);
        if (entryBeat === 10) {
            recordingPassTiming.observeEntry(['capture'], 10.1, 53.05, false);
        }
        const first = pass('first', 'capture', entryBeat - 6);
        recordingPassTiming.stage(first, 54);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 2.9)).toBeCloseTo(entryBeat === 10 ? 2.1 : 1.35, 10);
    });

    it('keeps a staged first entry when its unsounded seam is cancelled and reused', () => {
        recordingPassTiming.begin('capture', 10);
        const first = pass('first');
        recordingPassTiming.stage(first, 52, true);
        recordingPassTiming.cancelBoundary('capture', 51.975);
        clock.loopStart = 11.9;
        recordingPassTiming.observeEntry(['capture'], 11.95, 51.975, true);
        recordingPassTiming.stage(first, 51.975);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 4.9)).toBeCloseTo(0.1, 10);
    });

    it('does not redate a first entry after its seam completed', () => {
        clock.beat = 6;
        clock.audioTimeSeconds = 51;
        recordingPassTiming.begin('capture', 6);
        recordingPassTiming.observeEntry(['capture'], 8, 52, false);
        const first = pass('first', 'capture', 2);
        recordingPassTiming.stage(first, 54, true);
        recordingPassTiming.observeEntry(['capture'], 8, 54, true);
        clock.loopStart = 10;
        recordingPassTiming.observeEntry(['capture'], 8.5, 54.25, false);
        recordingPassTiming.observeEntry(['capture'], 10, 55, false);
        const second = pass('second', 'capture', 6);
        recordingPassTiming.stage(second, 56);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 2.9)).toBeCloseTo(1.1, 10);
        expect(recordingPassTiming.depthSeconds(second, 50.9, 2.9)).toBeCloseTo(4.1, 10);
    });

    it('reuses a cancelled planned pass while later starts follow sounded boundaries', () => {
        recordingPassTiming.begin('capture', 10);
        const first = pass('first');
        recordingPassTiming.stage(first, 52, true);
        recordingPassTiming.cancelBoundary('capture', 51.5);
        expect(recordingPassTiming.replacementTakeId('capture')).toBe(first.id);
        recordingPassTiming.stage(first, 51.5);
        recordingPassTiming.relocateEntry('capture', 9);
        expect(recordingPassTiming.nextStartBeat('capture')).toBe(9);
        const second = pass('second', 'capture', 2);
        recordingPassTiming.stage(second, 53, true);
        recordingPassTiming.observeEntry(['capture'], 8, 53, false);
        const third = pass('third', 'capture', 6);
        recordingPassTiming.stage(third, 55);
        expect(recordingPassTiming.depthSeconds(first, 50.9, 4.9)).toBeCloseTo(0.1, 10);
        expect(recordingPassTiming.depthSeconds(second, 50.9, 4.9)).toBeCloseTo(0.6, 10);
        expect(recordingPassTiming.depthSeconds(third, 50.9, 4.9)).toBeCloseTo(2.1, 10);
    });

    it('bounds an ordinary ending on its frozen map without shortening completed passes', () => {
        recordingPassTiming.begin('capture', 10);
        const completed = pass('completed');
        recordingPassTiming.stage(completed, 52);
        const ending = {
            contextSeconds: 52.25,
            beatAtContextSeconds: (seconds: number) => 8.5 + (seconds - 52.25) * 2,
        };
        expect(recordingPassTiming.finish('capture', ending, 8.5)).toBeUndefined();
        clock.tempo = 60;
        expect(recordingPassTiming.captureEnd('capture', 53.25)).toEqual({ takeId: undefined, endBeat: 8.5 });
        expect(recordingPassTiming.captureEnd('capture', 52.15)?.endBeat).toBeCloseTo(8.3, 10);
        expect(recordingPassTiming.depthSeconds(completed, 50.9, 4.9)).toBeCloseTo(0.1, 10);
        expect(completed.endBeat).toBe(12);
    });

    it('does not reinterpret held pre-roll capture as a moving song ending', () => {
        clock.isPlaying = false;
        recordingPassTiming.begin('capture', 10, () => null);
        const ending = { contextSeconds: 53, beatAtContextSeconds: () => 10 };
        expect(recordingPassTiming.finish('capture', ending, 10)).toBeUndefined();
        expect(recordingPassTiming.captureEnd('capture', 54)).toBeUndefined();
    });

    it('finalizes an incoming lap only through captured PCM and the frozen ending', () => {
        recordingPassTiming.begin('capture', 10);
        recordingPassTiming.stage(pass('completed'), 52, true);
        recordingPassTiming.observeEntry(['capture'], 8, 52, true);
        recordingPassTiming.finish(
            'capture',
            {
                contextSeconds: 52.25,
                beatAtContextSeconds: (seconds) => 8 + (seconds - 52) * 2,
            },
            8.5
        );
        clock.tempo = 60;
        const empty = { startBeat: 8, endBeat: 8, passEndContextSeconds: 52 };
        expect(recordingPassTiming.finalPass('capture', 51.9)).toEqual(empty);
        expect(recordingPassTiming.finalPass('capture', 52)).toEqual(empty);
        expect(recordingPassTiming.finalPass('capture', 52.15)?.endBeat).toBeCloseTo(8.3, 10);
        expect(recordingPassTiming.finalPass('capture', 53)).toEqual({
            startBeat: 8,
            endBeat: 8.5,
            passEndContextSeconds: 52.25,
        });
    });

    it.each([false, true])(
        'does not invent an incoming lap before a planned seam sounds, cancelled=%s',
        (cancelled) => {
            recordingPassTiming.begin('capture', 10);
            recordingPassTiming.stage(pass('planned'), 52, true);
            if (cancelled) {
                recordingPassTiming.cancelBoundary('capture', 51.9);
            }
            recordingPassTiming.finish('capture', { contextSeconds: 51.9, beatAtContextSeconds: () => 11.8 }, 11.8);
            expect(recordingPassTiming.finalPass('capture', 53)).toBeUndefined();
        }
    );

    it('does not invent a loop pass for an ordinary first ending or a retired owner', () => {
        recordingPassTiming.begin('capture', 10);
        recordingPassTiming.finish('capture', { contextSeconds: 51.5, beatAtContextSeconds: () => 11 }, 11);
        expect(recordingPassTiming.finalPass('capture', 53)).toBeUndefined();
        recordingPassTiming.retire('capture');
        expect(recordingPassTiming.finalPass('capture', 53)).toBeUndefined();
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
