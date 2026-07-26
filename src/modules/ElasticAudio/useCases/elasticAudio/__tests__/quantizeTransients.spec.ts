import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    trackStoreValue: {
        tracks: [] as Array<{
            clips: Array<{ id: string; type: string }>;
        }>,
    },
    workspaceValue: { snapValue: 0.25 },
    pushUndoEntry: vi.fn(),
    warpStates: new Map<
        string,
        {
            enabled: boolean;
            stretchMode: 'repitch' | 'complex' | 'texture' | 'beats';
            markers: Array<{ id: string; originalBeat: number; warpedBeat: number; origin?: string; locked?: boolean }>;
            originalTempo: number | null;
        }
    >(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
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

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: {
        get value() {
            return mocks.workspaceValue;
        },
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: (...args: unknown[]) => mocks.pushUndoEntry(...args),
}));

import { quantizeTransients } from '../quantizeTransients';

describe('quantizeTransients', () => {
    beforeEach(() => {
        mocks.pushUndoEntry.mockReset();
        mocks.warpStates.clear();
        mocks.workspaceValue = { snapValue: 0.25 };
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1', type: 'audio' }] }],
        };
    });

    it('returns NO_MARKERS if there are no warp markers yet', () => {
        const result = quantizeTransients('c1');
        expect(result).toEqual({ ok: false, reason: 'NO_MARKERS' });
    });

    it('snaps non-locked markers to the nearest grid position', () => {
        mocks.warpStates.set('c1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: null,
            markers: [
                { id: 'm1', originalBeat: 0.31, warpedBeat: 0.31, origin: 'transient-auto' },
                { id: 'm2', originalBeat: 0.74, warpedBeat: 0.74, origin: 'transient-auto' },
                { id: 'm3', originalBeat: 1.13, warpedBeat: 1.13, origin: 'transient-auto' },
            ],
        });

        const result = quantizeTransients('c1');
        expect(result).toEqual({ ok: true, moved: 3 });
        const after = mocks.warpStates.get('c1')!;
        expect(after.markers.map((m) => m.warpedBeat)).toEqual([0.25, 0.75, 1.25]);
        expect(after.markers.every((m) => m.origin === 'grid-snap')).toBe(true);
    });

    it('preserves locked markers', () => {
        mocks.warpStates.set('c1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: null,
            markers: [
                { id: 'm1', originalBeat: 0.31, warpedBeat: 0.31, origin: 'transient-auto' },
                { id: 'm2', originalBeat: 0.74, warpedBeat: 0.74, origin: 'user', locked: true },
            ],
        });

        const result = quantizeTransients('c1');
        expect(result).toEqual({ ok: true, moved: 1 });
        const after = mocks.warpStates.get('c1')!;
        const locked = after.markers.find((m) => m.id === 'm2')!;
        expect(locked.warpedBeat).toBe(0.74);
        expect(locked.locked).toBe(true);
    });

    it('quantizes without rewriting stretchMode to a mode that has no executor', () => {
        mocks.warpStates.set('c1', {
            enabled: true,
            stretchMode: 'repitch',
            originalTempo: null,
            markers: [{ id: 'm1', originalBeat: 0.3, warpedBeat: 0.3, origin: 'transient-auto' }],
        });

        quantizeTransients('c1');
        const after = mocks.warpStates.get('c1')!;
        expect(after.markers.map((m) => m.warpedBeat)).toEqual([0.25]);
        expect(after.stretchMode).toBe('repitch');
    });

    it('pushes a single undo entry for the whole quantize op', () => {
        mocks.warpStates.set('c1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: null,
            markers: [
                { id: 'm1', originalBeat: 0.3, warpedBeat: 0.3, origin: 'transient-auto' },
                { id: 'm2', originalBeat: 0.7, warpedBeat: 0.7, origin: 'transient-auto' },
            ],
        });

        quantizeTransients('c1');
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
    });

    it('returns CLIP_NOT_AUDIO for MIDI clips', () => {
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1', type: 'midi' }] }],
        };
        const result = quantizeTransients('c1');
        expect(result).toEqual({ ok: false, reason: 'CLIP_NOT_AUDIO' });
    });
});
