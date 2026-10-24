import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
    warpStates: new Map<
        string,
        {
            enabled: boolean;
            markers: Array<{ id: string; originalBeat: number; warpedBeat: number; origin?: string; locked?: boolean }>;
            stretchMode: 'repitch' | 'phase-vocoder' | 'wsola';
            originalTempo: number | null;
        }
    >(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: (...args: unknown[]) => mocks.pushUndoEntry(...args),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    warpStates: mocks.warpStates,
    getWarpState: (clipId: string) =>
        mocks.warpStates.get(clipId) ?? {
            enabled: false,
            markers: [],
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        },
    getStoredWarpState: (clipId: string) => mocks.warpStates.get(clipId),
    setWarpState: (
        clipId: string,
        state: {
            enabled: boolean;
            markers: Array<{ id: string; originalBeat: number; warpedBeat: number; origin?: string; locked?: boolean }>;
            stretchMode: 'repitch' | 'phase-vocoder' | 'wsola';
            originalTempo: number | null;
        }
    ) => {
        mocks.warpStates.set(clipId, state);
    },
    warpStateStore: {
        get value() {
            return { states: Object.fromEntries(mocks.warpStates) };
        },
    },
}));

import { toggleMarkerLock } from '../toggleMarkerLock';

describe('toggleMarkerLock', () => {
    beforeEach(() => {
        mocks.warpStates.clear();
        mocks.pushUndoEntry.mockReset();
    });

    it('is a no-op when the marker cannot be found', () => {
        toggleMarkerLock('clip-1', 'missing');
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('flips the locked flag on the target marker', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [
                { id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user', locked: false },
                { id: 'm-2', originalBeat: 2, warpedBeat: 2, origin: 'user', locked: true },
            ],
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });

        toggleMarkerLock('clip-1', 'm-1');
        expect(mocks.warpStates.get('clip-1')?.markers.find((m) => m.id === 'm-1')!.locked).toBe(true);
        toggleMarkerLock('clip-1', 'm-2');
        expect(mocks.warpStates.get('clip-1')?.markers.find((m) => m.id === 'm-2')!.locked).toBe(false);
    });

    it('toggles only the named clip marker when two clips share the marker id', () => {
        // Warp-marker identity is clip-local (#5570): the lock toggle targets
        // the clip it was opened on, never a same-id marker in another clip.
        const markers = (beat: number, locked: boolean) => [
            { id: 'm-1', originalBeat: beat, warpedBeat: beat, origin: 'user' as const, locked },
        ];
        mocks.warpStates.set('clip-a', {
            enabled: true,
            markers: markers(1, false),
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });
        mocks.warpStates.set('clip-b', {
            enabled: true,
            markers: markers(2, false),
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });

        toggleMarkerLock('clip-b', 'm-1');

        expect(mocks.warpStates.get('clip-a')!.markers[0]!.locked).toBe(false);
        expect(mocks.warpStates.get('clip-b')!.markers[0]!.locked).toBe(true);
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        (undoFn as () => void)();
        expect(mocks.warpStates.get('clip-a')!.markers[0]!.locked).toBe(false);
        expect(mocks.warpStates.get('clip-b')!.markers[0]!.locked).toBe(false);
    });

    it('pushes an undo entry that reverts the toggle', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [{ id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user', locked: false }],
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });
        toggleMarkerLock('clip-1', 'm-1');
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        (undoFn as () => void)();
        expect(mocks.warpStates.get('clip-1')?.markers[0]!.locked).toBe(false);
    });
});
