import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markerStore } from '#/modules/Arrangement/stores';

import { captureGestureBeat } from '../../../stores/captureGestureBeat';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { seekPlayhead } from '../../../useCases/transportControls/seekPlayhead';
import { handleNavigateSection } from '../handleNavigateSection';

const clock = vi.hoisted(() => ({
    readAudioTime: vi.fn<() => number>(),
    readNativeCursor: vi.fn<() => number | null>(),
}));

vi.mock('../../../stores/gestureClockSource', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/gestureClockSource')>()),
    getGestureClockSource: () => ({
        getAudioTimeSeconds: clock.readAudioTime,
        readNativeCursorBeats: clock.readNativeCursor,
    }),
}));
vi.mock('../../../useCases/transportControls/seekPlayhead', () => ({ seekPlayhead: vi.fn() }));

const original = {
    transport: transportStore.value,
    tempoMap: tempoMapStore.value,
    markers: markerStore.value,
    anchor: {
        beat: playheadClockRef.beat,
        audioTimeSeconds: playheadClockRef.audioTimeSeconds,
        generation: playheadClockRef.generation,
        pendingLoopSeam: playheadClockRef.pendingLoopSeam,
        hold: playheadClockRef.hold,
    },
    publishedBeat: playheadPositionRef.current,
};

beforeEach(() => {
    vi.clearAllMocks();
    transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 8 });
    tempoMapStore.set({ changes: [] });
    markerStore.set({
        markers: [],
        sections: [
            { id: 'chorus', name: 'Chorus', startBeat: 32, endBeat: 48, color: '#778899' },
            { id: 'intro', name: 'Intro', startBeat: 4, endBeat: 12, color: '#778899' },
            { id: 'verse', name: 'Verse', startBeat: 16, endBeat: 28, color: '#778899' },
        ],
    });
    playheadClockRef.beat = 15.99;
    playheadClockRef.audioTimeSeconds = 480_000 / 48_000;
    playheadClockRef.pendingLoopSeam = null;
    playheadClockRef.hold = null;
    playheadPositionRef.current = 15.99;
    // Only the hardware clock seam moves: 480 further source frames cross beat16.
    clock.readAudioTime.mockReturnValue(480_480 / 48_000);
    clock.readNativeCursor.mockReturnValue(null);
});

afterEach(() => {
    transportStore.set(original.transport);
    tempoMapStore.set(original.tempoMap);
    markerStore.set(original.markers);
    Object.assign(playheadClockRef, original.anchor);
    playheadPositionRef.current = original.publishedBeat;
});

function expectCurrentBeat(beat: number): void {
    expect(captureGestureBeat()).toBeCloseTo(beat, 9);
    clock.readAudioTime.mockClear();
    clock.readNativeCursor.mockClear();
}

describe('section navigation current clock', () => {
    it.each([
        { direction: 'next' as const, target: 32 },
        { direction: 'previous' as const, target: 16 },
    ])(
        'moves $direction after the source clock crosses the section boundary ahead of the published cursor',
        ({ direction, target }) => {
            expectCurrentBeat(16.01);
            expect(playheadPositionRef.current).toBe(15.99);
            expect(transportStore.value?.playheadPosition).toBe(8);

            handleNavigateSection.execute({ type: 'navigateSection', payload: { direction } });

            expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(target);
            expect(clock.readNativeCursor).toHaveBeenCalledTimes(1);
            expect(clock.readAudioTime).toHaveBeenCalledTimes(1);
        }
    );

    it('uses the tempo-map integral when the clock crosses a tempo boundary', () => {
        tempoMapStore.set({
            changes: [
                { id: 'initial', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slower', beat: 16, tempo: 60, curve: 'instant' },
            ],
        });
        expectCurrentBeat(16.005);

        handleNavigateSection.execute({ type: 'navigateSection', payload: { direction: 'next' } });

        expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(32);
        expect(clock.readAudioTime).toHaveBeenCalledTimes(1);
    });

    it('uses the wrapped current occurrence after the source clock crosses the loop end', () => {
        transportStore.set({
            ...defaultTransportState,
            isPlaying: true,
            tempo: 120,
            isLooping: true,
            loopStart: 4,
            loopEnd: 16,
        });
        playheadPositionRef.current = 50;
        expectCurrentBeat(4.01);

        handleNavigateSection.execute({ type: 'navigateSection', payload: { direction: 'previous' } });

        expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(4);
        expect(clock.readAudioTime).toHaveBeenCalledTimes(1);
    });

    it.each([
        { direction: 'next' as const, target: 32 },
        { direction: 'previous' as const, target: 4 },
    ])('uses the authoritative parked beat and skips its exact start moving $direction', ({ direction, target }) => {
        transportStore.set({ ...defaultTransportState, isPlaying: false, playheadPosition: 16 });
        playheadPositionRef.current = 50;

        handleNavigateSection.execute({ type: 'navigateSection', payload: { direction } });

        expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(target);
        expect(clock.readAudioTime).not.toHaveBeenCalled();
        expect(clock.readNativeCursor).not.toHaveBeenCalled();
    });

    it.each([
        { cursor: 16.01, direction: 'next' as const, target: 32 },
        { cursor: 16, direction: 'previous' as const, target: 4 },
    ])(
        'uses the native cursor at $cursor moving $direction without reading browser time',
        ({ cursor, direction, target }) => {
            clock.readNativeCursor.mockReturnValue(cursor);
            playheadPositionRef.current = 50;

            handleNavigateSection.execute({ type: 'navigateSection', payload: { direction } });

            expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(target);
            expect(clock.readNativeCursor).toHaveBeenCalledTimes(1);
            expect(clock.readAudioTime).not.toHaveBeenCalled();
        }
    );

    it('does not navigate to an invalid section and remains outside project history', () => {
        markerStore.set({
            markers: [],
            sections: [{ id: 'invalid', name: 'Invalid', startBeat: 32, endBeat: 16, color: '#778899' }],
        });

        handleNavigateSection.execute({ type: 'navigateSection', payload: { direction: 'next' } });

        expect(seekPlayhead).not.toHaveBeenCalled();
        expect(handleNavigateSection.executionKind).toBe('runtime');
        expect(handleNavigateSection.undoable).toBe(false);
    });
});
