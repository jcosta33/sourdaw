import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
    warpStates: new Map<
        string,
        {
            enabled: boolean;
            markers: Array<{ id: string; originalBeat: number; warpedBeat: number; origin?: string; locked?: boolean }>;
            stretchMode: 'repitch' | 'complex' | 'texture' | 'beats';
            originalTempo: number | null;
        }
    >(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: (...args: unknown[]) => mocks.pushUndoEntry(...args),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    addWarpMarker: (clipId: string, originalBeat: number, warpedBeat: number, options?: { origin?: string }) => {
        const state = mocks.warpStates.get(clipId) ?? {
            enabled: false,
            markers: [],
            stretchMode: 'complex' as const,
            originalTempo: null,
        };
        const nextMarkers = [
            ...state.markers,
            {
                id: `m-${state.markers.length}`,
                originalBeat,
                warpedBeat,
                origin: options?.origin ?? 'user',
                locked: false,
            },
        ];
        mocks.warpStates.set(clipId, { ...state, markers: nextMarkers });
    },
    warpStates: mocks.warpStates,
    getWarpState: (clipId: string) =>
        mocks.warpStates.get(clipId) ?? {
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        },
}));

import { addManualMarker } from '../addManualMarker';

describe('addManualMarker', () => {
    beforeEach(() => {
        mocks.warpStates.clear();
        mocks.pushUndoEntry.mockReset();
    });

    it('writes a marker with origin user and pushes an undo entry', () => {
        addManualMarker('clip-1', 2.5);
        const state = mocks.warpStates.get('clip-1');
        expect(state?.markers.length).toBe(1);
        expect(state?.markers[0]!.originalBeat).toBe(2.5);
        expect(state?.markers[0]!.origin).toBe('user');
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
    });

    it('undo restores the previous marker list', () => {
        addManualMarker('clip-1', 1.0);
        addManualMarker('clip-1', 2.0);
        expect(mocks.warpStates.get('clip-1')?.markers.length).toBe(2);

        const secondCall = mocks.pushUndoEntry.mock.calls[1];
        const undoFn = secondCall![1] as () => void;
        undoFn();
        expect(mocks.warpStates.get('clip-1')?.markers.length).toBe(1);
    });

    it('redo reinstates the added marker', () => {
        addManualMarker('clip-1', 1.0);
        const [, undoFn, redoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        (undoFn as () => void)();
        expect(mocks.warpStates.get('clip-1')?.markers.length).toBe(0);
        (redoFn as () => void)();
        expect(mocks.warpStates.get('clip-1')?.markers.length).toBe(1);
    });
});
