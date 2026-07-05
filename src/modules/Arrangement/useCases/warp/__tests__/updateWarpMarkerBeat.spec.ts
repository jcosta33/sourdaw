import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

import { warpStates } from '../../../stores/warpStates';
import { updateWarpMarkerBeat } from '../updateWarpMarkerBeat';

describe('updateWarpMarkerBeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        warpStates.clear();
    });

    it('should update the target marker warped beat', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        updateWarpMarkerBeat({ clipId: 'c1', markerId: 'm1', field: 'warpedBeat', beat: 1.5 });

        expect(warpStates.get('c1')?.markers[0]).toEqual({
            id: 'm1',
            originalBeat: 1,
            warpedBeat: 1.5,
            origin: 'user',
        });
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('should update the target marker original beat', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1.25, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        updateWarpMarkerBeat({ clipId: 'c1', markerId: 'm1', field: 'originalBeat', beat: 0.75 });

        expect(warpStates.get('c1')?.markers[0]).toEqual({
            id: 'm1',
            originalBeat: 0.75,
            warpedBeat: 1.25,
            origin: 'user',
        });
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('should create undo and redo callbacks for the beat edit', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        updateWarpMarkerBeat({
            clipId: 'c1',
            markerId: 'm1',
            field: 'warpedBeat',
            beat: 2,
            undoGroupId: 'drag-1',
            undoGroupLabel: 'Move elastic marker',
        });

        const [label, undo, redo, options] = mocks.pushUndoEntry.mock.calls[0] as [
            string,
            () => void,
            () => void,
            { groupId?: string; groupLabel?: string } | undefined,
        ];
        expect(label).toBe('Move elastic marker warp beat');
        expect(options).toEqual({ groupId: 'drag-1', groupLabel: 'Move elastic marker' });

        undo();
        expect(warpStates.get('c1')?.markers[0]?.warpedBeat).toBe(1);

        redo();
        expect(warpStates.get('c1')?.markers[0]?.warpedBeat).toBe(2);
    });

    it('should not create warp state for a missing clip', () => {
        updateWarpMarkerBeat({ clipId: 'missing', markerId: 'm1', field: 'warpedBeat', beat: 1.5 });

        expect(warpStates.has('missing')).toBe(false);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });
});
