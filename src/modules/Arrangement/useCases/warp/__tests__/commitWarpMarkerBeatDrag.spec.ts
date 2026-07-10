import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

import { warpStates } from '../../../stores/warpStates';
import { commitWarpMarkerBeatDrag } from '../commitWarpMarkerBeatDrag';

describe('commitWarpMarkerBeatDrag', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        warpStates.clear();
    });

    it('should create one undo entry from the start beats to the current beats', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [
                { id: 'm1', originalBeat: 1.25, warpedBeat: 2.5, origin: 'user' },
                { id: 'm2', originalBeat: 4, warpedBeat: 4, origin: 'user' },
            ],
            stretchMode: 'complex',
            originalTempo: null,
        });

        commitWarpMarkerBeatDrag({
            clipId: 'c1',
            markerId: 'm1',
            beforeOriginalBeat: 1,
            beforeWarpedBeat: 2,
        });

        const [label, undo, redo] = mocks.pushUndoEntry.mock.calls[0] as [string, () => void, () => void];
        expect(label).toBe('Move elastic marker');

        undo();
        expect(warpStates.get('c1')?.markers).toEqual([
            { id: 'm1', originalBeat: 1, warpedBeat: 2, origin: 'user' },
            { id: 'm2', originalBeat: 4, warpedBeat: 4, origin: 'user' },
        ]);

        redo();
        expect(warpStates.get('c1')?.markers).toEqual([
            { id: 'm1', originalBeat: 1.25, warpedBeat: 2.5, origin: 'user' },
            { id: 'm2', originalBeat: 4, warpedBeat: 4, origin: 'user' },
        ]);
    });

    it('should not create an undo entry when the marker did not move', () => {
        warpStates.set('c1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 2, origin: 'user' }],
            stretchMode: 'complex',
            originalTempo: null,
        });

        commitWarpMarkerBeatDrag({
            clipId: 'c1',
            markerId: 'm1',
            beforeOriginalBeat: 1,
            beforeWarpedBeat: 2,
        });

        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('should not create warp state for a missing clip', () => {
        commitWarpMarkerBeatDrag({
            clipId: 'missing',
            markerId: 'm1',
            beforeOriginalBeat: 1,
            beforeWarpedBeat: 2,
        });

        expect(warpStates.has('missing')).toBe(false);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });
});
