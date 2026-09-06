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

import { removeMarker } from '../removeMarker';

describe('removeMarker', () => {
    beforeEach(() => {
        mocks.warpStates.clear();
        mocks.pushUndoEntry.mockReset();
    });

    it('is a no-op when the marker cannot be found', () => {
        removeMarker('missing');
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('removes the target marker from its owning clip', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [
                { id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user' },
                { id: 'm-2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
            ],
            stretchMode: 'complex',
            originalTempo: null,
        });
        removeMarker('m-1');
        const markers = mocks.warpStates.get('clip-1')!.markers;
        expect(markers.map((m) => m.id)).toEqual(['m-2']);
    });

    it('undo restores the removed marker', () => {
        mocks.warpStates.set('clip-1', {
            enabled: true,
            markers: [
                { id: 'm-1', originalBeat: 1, warpedBeat: 1, origin: 'user' },
                { id: 'm-2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
            ],
            stretchMode: 'complex',
            originalTempo: null,
        });
        removeMarker('m-1');
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        (undoFn as () => void)();
        const markers = mocks.warpStates.get('clip-1')!.markers;
        expect(markers.map((m) => m.id).sort()).toEqual(['m-1', 'm-2']);
    });
});
