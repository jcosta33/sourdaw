import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import { stopPlayback } from '#/modules/Transport/useCases';

import { setlistStore, type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { advanceSetlistItemEnd } from '../advanceSetlistItemEnd';
import { goToItem } from '../goToItem';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

const stopPlaybackMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

const transportRuntime = vi.hoisted(() => ({
    isPlaying: false,
    tempo: 120,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    secondsBetweenBeats: (
        _changes: readonly unknown[],
        fromBeat: number,
        toBeat: number,
        defaultTempo: number
    ): number => {
        return ((toBeat - fromBeat) * 60) / defaultTempo;
    },
    stopPlayback: stopPlaybackMock,
}));

vi.mock('#/modules/Transport/stores', () => ({
    playheadPositionRef: { current: 0 },
    transportStore: {
        get value() {
            return transportRuntime;
        },
    },
    tempoMapStore: {
        value: { changes: [] },
    },
}));

function makeItem(overrides: Partial<SetlistItem> = {}): SetlistItem {
    return {
        id: 'item',
        name: 'Song',
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: 4,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: false,
        gapSeconds: 0,
        markers: [],
        ...overrides,
    };
}

function seed(overrides: Partial<SetlistState> = {}): void {
    setlistStore.set({
        name: 'Set',
        items: [],
        currentIndex: 0,
        autoAdvance: false,
        countInBars: 1,
        ...overrides,
    });
}

function injectEventBus(): void {
    const eventBus = createMock<EventBusShape>();
    eventBus.emit.mockResolvedValue(undefined);
    injectDependencies(goToItem, { eventBus });
}

function setPlaying(isPlaying: boolean): void {
    transportRuntime.isPlaying = isPlaying;
}

function armAtBeat(beat: number): void {
    playheadPositionRef.current = beat;
    setPlaying(true);
    advanceSetlistItemEnd();
}

describe('advanceSetlistItemEnd', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        stopPlaybackMock.mockClear();
        transportRuntime.isPlaying = false;
        transportRuntime.tempo = 120;
        playheadPositionRef.current = 0;
        seed();
        injectEventBus();
        advanceSetlistItemEnd();
        vi.clearAllTimers();
    });

    afterEach(() => {
        transportRuntime.isPlaying = false;
        advanceSetlistItemEnd();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('advances to the next item after estimatedDuration elapses, waiting gapSeconds', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 2, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        expect(setlistStore.value?.currentIndex).toBe(0);

        vi.advanceTimersByTime(1999);
        expect(setlistStore.value?.currentIndex).toBe(0);

        vi.advanceTimersByTime(1);
        expect(setlistStore.value?.currentIndex).toBe(1);
        expect(stopPlayback).not.toHaveBeenCalled();
        expect(transportStore.value?.isPlaying).toBe(true);
    });

    it('stops without advancing when the current item has autoStop, even if autoAdvance is on', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: true, gapSeconds: 0, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(setlistStore.value?.currentIndex).toBe(0);
    });

    it('stops on the last item when autoAdvance is on and does not wrap to 0', () => {
        seed({
            autoAdvance: true,
            currentIndex: 1,
            items: [
                makeItem({ id: 'a', autoStop: false, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(setlistStore.value?.currentIndex).toBe(1);
    });

    it('does not advance or stop when estimatedDuration is 0', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, estimatedDuration: 0, gapSeconds: 0 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 64;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('does not end the item from wall time while transport is not playing', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        setPlaying(false);
        playheadPositionRef.current = 8;
        vi.advanceTimersByTime(60_000);
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('consumes item end only once when called repeatedly after duration elapses', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
                makeItem({ id: 'c', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(1);
        expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('does not cancel a pending gap advance when the playhead wraps during the gap', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 2, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(8);
        playheadPositionRef.current = 16;
        advanceSetlistItemEnd();

        expect(setlistStore.value?.currentIndex).toBe(0);

        playheadPositionRef.current = 0;
        advanceSetlistItemEnd();

        expect(setlistStore.value?.currentIndex).toBe(0);

        vi.advanceTimersByTime(2000);

        expect(setlistStore.value?.currentIndex).toBe(1);
        expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('ends only after beat-derived elapsed time reaches estimatedDuration, not beat delta alone', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 4;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(stopPlayback).not.toHaveBeenCalled();

        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(1);
        expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('re-arms when the playhead moves backward and does not treat wrap as item end', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 0, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(8);
        playheadPositionRef.current = 0;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(stopPlayback).not.toHaveBeenCalled();

        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(1);
    });
});
