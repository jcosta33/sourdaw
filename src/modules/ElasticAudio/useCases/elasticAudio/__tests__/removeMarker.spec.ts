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

import { removeMarker } from '../removeMarker';

describe('removeMarker', () => {
    beforeEach(() => {
        mocks.warpStates.clear();
        mocks.pushUndoEntry.mockReset();
    });

    it('is a no-op when the marker cannot be found', () => {
        removeMarker('clip-1', 'missing');
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('removes the target marker from its owning clip', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [
                { id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user' },
                { id: 'm-2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
            ],
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });
        removeMarker('clip-1', 'm-1');
        const markers = mocks.warpStates.get('clip-1')!.markers;
        expect(markers.map((m) => m.id)).toEqual(['m-2']);
    });

    it('removes only the named clip marker when two clips share the marker id', () => {
        // Warp-marker identity is clip-local (#5570): duplication copies marker
        // ids into independent states, so removing in one clip must leave the
        // other clip's same-id marker untouched.
        const markers = (beat: number) => [{ id: 'm-1', originalBeat: beat, warpedBeat: beat, origin: 'user' }];
        mocks.warpStates.set('clip-a', {
            enabled: true,
            markers: markers(1),
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });
        mocks.warpStates.set('clip-b', {
            enabled: true,
            markers: markers(2),
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });

        removeMarker('clip-b', 'm-1');

        expect(mocks.warpStates.get('clip-a')!.markers.map((m) => m.id)).toEqual(['m-1']);
        expect(mocks.warpStates.get('clip-b')!.markers).toEqual([]);
        // Undo restores only the clip the edit targeted.
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        (undoFn as () => void)();
        expect(mocks.warpStates.get('clip-a')!.markers.map((m) => m.id)).toEqual(['m-1']);
        expect(mocks.warpStates.get('clip-b')!.markers.map((m) => m.id)).toEqual(['m-1']);
    });

    it('undo restores the removed marker', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [
                { id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user' },
                { id: 'm-2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
            ],
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });
        removeMarker('clip-1', 'm-1');
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        (undoFn as () => void)();
        const markers = mocks.warpStates.get('clip-1')!.markers;
        expect(markers.map((m) => m.id).sort()).toEqual(['m-1', 'm-2']);
    });
});
