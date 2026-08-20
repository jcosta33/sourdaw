import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleStripSilence } from '../handleStripSilence';

const mocks = vi.hoisted(() => ({
    prepareStripSilence: vi.fn(),
    restoreStripSilenceState: vi.fn(),
    stripSilence: vi.fn(),
}));

vi.mock('../../../useCases/prepareStripSilence', () => ({
    prepareStripSilence: mocks.prepareStripSilence,
}));
vi.mock('../../../useCases/restoreStripSilenceState', () => ({
    restoreStripSilenceState: mocks.restoreStripSilenceState,
}));
vi.mock('../../../useCases/stripSilence', () => ({
    stripSilence: mocks.stripSilence,
}));

describe('handleStripSilence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.stripSilence.mockReturnValue(true);
        mocks.prepareStripSilence.mockReturnValue(null);
        mocks.restoreStripSilenceState.mockReturnValue(true);
    });

    it('executes stripSilence with the provided payload when no plan is materialized', () => {
        const result = handleStripSilence.execute({
            type: 'stripSilence',
            payload: { clipId: 'c1', threshold: -30, minDuration: 0.1 },
        });

        expect(mocks.stripSilence).toHaveBeenCalledWith('c1', -30, 0.1);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when strip silence is rejected', () => {
        mocks.stripSilence.mockReturnValue(false);

        const result = handleStripSilence.execute({
            type: 'stripSilence',
            payload: { clipId: 'vca-clip' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('clears stale internal replay fields when fresh preflight rejects the action', () => {
        mocks.stripSilence.mockReturnValue(false);
        const stale = { trackId: 't1', clips: [], clipOrder: [], clipSatellites: [], clipAutomationLanes: [] };
        const action = {
            type: 'stripSilence' as const,
            payload: { clipId: 'c1', expected: stale, replacement: stale },
        };

        const description = handleStripSilence.describe(action);
        const result = handleStripSilence.execute(action);

        expect(description.inverseAction).toBeNull();
        expect(action.payload).toEqual({ clipId: 'c1' });
        expect(mocks.stripSilence).toHaveBeenCalledWith('c1', undefined, undefined);
        expect(mocks.restoreStripSilenceState).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleStripSilence.describe({
            type: 'stripSilence',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Strip silence');
        expect(desc.inverseAction).toBeNull();
    });

    it('captures a stable guarded inverse and redo plan', () => {
        const previous = { trackId: 't1', clips: [], clipOrder: ['c1'], clipSatellites: [], clipAutomationLanes: [] };
        const next = { trackId: 't1', clips: [], clipOrder: ['s1', 's2'], clipSatellites: [], clipAutomationLanes: [] };
        mocks.prepareStripSilence.mockReturnValue({ previous, next, newClipIds: ['s1', 's2'] });
        const action = {
            type: 'stripSilence' as const,
            payload: { clipId: 'c1', expected: next, replacement: previous },
        };

        const desc = handleStripSilence.describe(action);

        expect(mocks.prepareStripSilence).toHaveBeenCalledWith({
            clipId: 'c1',
            threshold: undefined,
            minDuration: undefined,
        });
        expect(action.payload).toMatchObject({ expected: previous, replacement: next });
        expect(desc.inverseAction).toEqual({
            type: 'restoreStripSilenceState',
            payload: { expected: next, replacement: previous },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreStripSilenceState',
            payload: { expected: previous, replacement: next },
        });

        const result = handleStripSilence.execute(action);
        expect(mocks.restoreStripSilenceState).toHaveBeenCalledWith({ expected: previous, replacement: next });
        expect(mocks.stripSilence).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'written' });
    });

    it('is undoable', () => {
        expect(handleStripSilence.undoable).toBe(true);
        expect(handleStripSilence.requiresAbortCompensation).toBe(false);
    });
});
