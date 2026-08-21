import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGlueClips } from '../handleGlueClips';

const mocks = vi.hoisted(() => ({
    glueClips: vi.fn(),
    prepareClipGlue: vi.fn(),
    restoreClipGlueState: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/glueClips', () => ({
    glueClips: mocks.glueClips,
}));
vi.mock('../../../useCases/clipEditing/prepareClipGlue', () => ({
    prepareClipGlue: mocks.prepareClipGlue,
}));
vi.mock('../../../useCases/clipEditing/restoreClipGlueState', () => ({
    restoreClipGlueState: mocks.restoreClipGlueState,
}));

describe('handleGlueClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.glueClips.mockReturnValue(true);
        mocks.prepareClipGlue.mockReturnValue(null);
    });

    it('executes glueClips with the provided payload', () => {
        const result = handleGlueClips.execute({
            type: 'glueClips',
            payload: { clipIds: ['c1', 'c2'] },
        });

        expect(mocks.glueClips).toHaveBeenCalledWith(['c1', 'c2'], undefined);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when glue is rejected', () => {
        mocks.glueClips.mockReturnValue(false);

        const result = handleGlueClips.execute({
            type: 'glueClips',
            payload: { clipIds: ['c1', 'c2'] },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('clears stale internal replay fields when fresh preflight rejects the action', () => {
        mocks.glueClips.mockReturnValue(false);
        const stale = {
            trackId: 'track-1',
            clips: [],
            clipOrder: [],
            midi: { clips: [], migratedAbsoluteNoteClipIds: { present: false, value: [] } },
            clipSatellites: [],
            clipAutomationLanes: [],
        };
        const action = {
            type: 'glueClips' as const,
            payload: {
                clipIds: ['c1', 'c2'],
                targetClipId: 'stale-target',
                expected: stale,
                replacement: stale,
            },
        };

        const description = handleGlueClips.describe(action);
        const result = handleGlueClips.execute(action);

        expect(description.inverseAction).toBeNull();
        expect(action.payload).toEqual({ clipIds: ['c1', 'c2'] });
        expect(mocks.glueClips).toHaveBeenCalledWith(['c1', 'c2'], undefined);
        expect(mocks.restoreClipGlueState).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleGlueClips.describe({
            type: 'glueClips',
            payload: { clipIds: [] },
        });
        expect(desc.label).toBe('Glue clips');
        expect(desc.inverseAction).toBeNull();
    });

    it('captures a stable guarded inverse and redo plan', () => {
        const previous = {
            trackId: 'track-1',
            clips: [],
            clipOrder: [],
            midi: { clips: [], migratedAbsoluteNoteClipIds: { present: false, value: [] } },
            clipSatellites: [],
            clipAutomationLanes: [],
        };
        const next = {
            trackId: 'track-1',
            clips: [],
            clipOrder: [],
            midi: { clips: [], migratedAbsoluteNoteClipIds: { present: true, value: ['target'] } },
            clipSatellites: [],
            clipAutomationLanes: [],
        };
        mocks.prepareClipGlue.mockReturnValue({ previous, next, targetClipId: 'target' });
        const action = {
            type: 'glueClips' as const,
            payload: { clipIds: ['c1', 'c2'], targetClipId: 'stale-target', expected: next, replacement: previous },
        };

        const desc = handleGlueClips.describe(action);

        expect(mocks.prepareClipGlue).toHaveBeenCalledWith({ clipIds: ['c1', 'c2'] });
        expect(action.payload).toMatchObject({ targetClipId: 'target', expected: previous, replacement: next });
        expect(desc.inverseAction).toEqual({
            type: 'restoreClipGlueState',
            payload: { expected: next, replacement: previous },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreClipGlueState',
            payload: { expected: previous, replacement: next },
        });
    });

    it('is undoable', () => {
        expect(handleGlueClips.undoable).toBe(true);
        expect(handleGlueClips.requiresAbortCompensation).toBe(false);
    });
});
