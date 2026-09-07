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
    warpStates: mocks.warpStates,
    getWarpState: (clipId: string) =>
        mocks.warpStates.get(clipId) ?? {
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        },
}));

import { toggleMarkerLock } from '../toggleMarkerLock';

describe('toggleMarkerLock', () => {
    beforeEach(() => {
        mocks.warpStates.clear();
        mocks.pushUndoEntry.mockReset();
    });

    it('is a no-op when the marker cannot be found', () => {
        toggleMarkerLock('missing');
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('flips the locked flag on the target marker', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [
                { id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user', locked: false },
                { id: 'm-2', originalBeat: 2, warpedBeat: 2, origin: 'user', locked: true },
            ],
            stretchMode: 'complex',
            originalTempo: null,
        });

        toggleMarkerLock('m-1');
        expect(mocks.warpStates.get('clip-1')?.markers.find((m) => m.id === 'm-1')!.locked).toBe(true);
        toggleMarkerLock('m-2');
        expect(mocks.warpStates.get('clip-1')?.markers.find((m) => m.id === 'm-2')!.locked).toBe(false);
    });

    it('pushes an undo entry that reverts the toggle', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [{ id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user', locked: false }],
            stretchMode: 'complex',
            originalTempo: null,
        });
        toggleMarkerLock('m-1');
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        (undoFn as () => void)();
        expect(mocks.warpStates.get('clip-1')?.markers[0]!.locked).toBe(false);
    });
});
