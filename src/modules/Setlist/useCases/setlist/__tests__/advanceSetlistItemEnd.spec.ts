import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import { stopPlayback } from '#/modules/Transport/useCases';

import { setlistStore, type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { advanceSetlistItemEnd } from '../advanceSetlistItemEnd';
import { goToItem } from '../goToItem';
import { removeSetlistItem } from '../removeSetlistItem';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

const stopPlaybackMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

const transportRuntime = vi.hoisted(() => ({
    isPlaying: false,
    tempo: 120,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
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
    setTempo: vi.fn(() => ({ status: 'written' as const })),
    setTimeSignature: vi.fn(),
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
        // Relocate while parked so any prior arm (pause-kept) is wiped between tests.
        playheadPositionRef.current = Number.POSITIVE_INFINITY;
        advanceSetlistItemEnd();
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

    it('restores a wrap-protected gap after pause/resume without cancelling nextItem', () => {
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

        playheadPositionRef.current = 0;
        advanceSetlistItemEnd();

        setPlaying(false);
        advanceSetlistItemEnd();

        vi.advanceTimersByTime(2000);
        expect(setlistStore.value?.currentIndex).toBe(0);

        setPlaying(true);
        advanceSetlistItemEnd();

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

    it('preserves duration arm across pause/resume without relocating the playhead', () => {
        seed({
            autoAdvance: false,
            currentIndex: 0,
            items: [makeItem({ id: 'a', autoStop: true, estimatedDuration: 4 })],
        });
        armAtBeat(0);
        playheadPositionRef.current = 6;
        advanceSetlistItemEnd();

        setPlaying(false);
        advanceSetlistItemEnd();

        setPlaying(true);
        advanceSetlistItemEnd();

        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        expect(stopPlayback).toHaveBeenCalledTimes(1);
    });

    it('starts a fresh duration after stop relocates the playhead while parked', () => {
        seed({
            autoAdvance: false,
            currentIndex: 0,
            items: [makeItem({ id: 'a', autoStop: true, estimatedDuration: 4 })],
        });
        armAtBeat(0);
        playheadPositionRef.current = 6;
        advanceSetlistItemEnd();

        setPlaying(false);
        playheadPositionRef.current = 3;
        advanceSetlistItemEnd();

        setPlaying(true);
        advanceSetlistItemEnd();

        playheadPositionRef.current = 7;
        advanceSetlistItemEnd();
        expect(stopPlayback).not.toHaveBeenCalled();

        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();
        expect(stopPlayback).not.toHaveBeenCalled();

        playheadPositionRef.current = 11;
        advanceSetlistItemEnd();
        expect(stopPlayback).toHaveBeenCalledTimes(1);
    });

    it('resumes gap advance after pause during the gap', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 2, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        setPlaying(false);
        advanceSetlistItemEnd();

        vi.advanceTimersByTime(2000);
        expect(setlistStore.value?.currentIndex).toBe(0);

        setPlaying(true);
        advanceSetlistItemEnd();
        advanceSetlistItemEnd();

        vi.advanceTimersByTime(1999);
        expect(setlistStore.value?.currentIndex).toBe(0);

        vi.advanceTimersByTime(1);
        expect(setlistStore.value?.currentIndex).toBe(1);
        expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('clears a pending gap timer when paused so nextItem does not fire while parked', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 2, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        expect(setlistStore.value?.currentIndex).toBe(0);

        setPlaying(false);
        advanceSetlistItemEnd();

        vi.advanceTimersByTime(2000);

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('does not advance past the successor when the ended item is removed during the gap', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 2, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
                makeItem({ id: 'c', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        removeSetlistItem('a');
        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(setlistStore.value?.items.map((item) => item.id)).toEqual(['b', 'c']);

        vi.advanceTimersByTime(2000);

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(setlistStore.value?.items[0]?.id).toBe('b');
    });

    it('re-arms the successor after remove-during-gap aborts so it can still auto-advance', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 2, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
                makeItem({ id: 'c', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        removeSetlistItem('a');
        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(setlistStore.value?.items[0]?.id).toBe('b');

        vi.advanceTimersByTime(2000);

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(setlistStore.value?.items[0]?.id).toBe('b');

        playheadPositionRef.current = 16;
        advanceSetlistItemEnd();
        vi.runOnlyPendingTimers();

        expect(setlistStore.value?.currentIndex).toBe(1);
        expect(setlistStore.value?.items[1]?.id).toBe('c');
    });

    it('does not advance when autoAdvance is turned off during the gap', () => {
        seed({
            autoAdvance: true,
            currentIndex: 0,
            items: [
                makeItem({ id: 'a', autoStop: false, gapSeconds: 2, estimatedDuration: 4 }),
                makeItem({ id: 'b', autoStop: false, estimatedDuration: 4 }),
            ],
        });
        armAtBeat(0);
        playheadPositionRef.current = 8;
        advanceSetlistItemEnd();

        const latest = setlistStore.value;
        if (latest === null) {
            throw new Error('setlist missing');
        }
        setlistStore.set({ ...latest, autoAdvance: false });

        vi.advanceTimersByTime(2000);

        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(stopPlayback).not.toHaveBeenCalled();
    });
});
