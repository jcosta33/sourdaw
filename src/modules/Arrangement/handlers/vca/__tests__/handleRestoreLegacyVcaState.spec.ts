import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRestoreLegacyVcaState } from '../handleRestoreLegacyVcaState';

const mocks = vi.hoisted(() => ({
    restoreLegacyVcaState: vi.fn<(payload: unknown) => 'written' | 'no-write' | 'conflict'>(),
    captureLegacyVcaState: vi.fn<(action: unknown) => unknown>(),
}));

vi.mock('../../../useCases/vca/restoreLegacyVcaState', () => ({
    restoreLegacyVcaState: (payload: unknown) => mocks.restoreLegacyVcaState(payload),
}));

vi.mock('../../../useCases/vca/captureLegacyVcaState', () => ({
    captureLegacyVcaState: (action: unknown) => mocks.captureLegacyVcaState(action),
}));

function action() {
    return {
        type: 'restoreLegacyVcaState' as const,
        payload: {
            groupRows: [],
            groupGains: [{ groupId: 'vca-1', expectedGain: 0.5, replacementGain: 1 }],
            groupMemberships: [],
            trackMemberships: [],
        },
    };
}

describe('handleRestoreLegacyVcaState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.captureLegacyVcaState.mockReturnValue({ captured: true });
    });

    it('reports a written status when the restore succeeds', () => {
        mocks.restoreLegacyVcaState.mockReturnValue('written');

        const result = handleRestoreLegacyVcaState.execute(action());
        if (!result || result instanceof Promise) {
            throw new Error('Expected a synchronous VCA restore execution result');
        }

        expect(result.status).toBe('written');
        expect(typeof result.afterCommit).toBe('function');
        expect(typeof result.afterAmbiguousCommit).toBe('function');
    });

    it('reports a conflict status when the restore detects one', () => {
        mocks.restoreLegacyVcaState.mockReturnValue('conflict');

        expect(handleRestoreLegacyVcaState.execute(action())).toEqual({ status: 'conflict' });
    });

    it('reports a no-write status when the restore makes no change', () => {
        mocks.restoreLegacyVcaState.mockReturnValue('no-write');

        expect(handleRestoreLegacyVcaState.execute(action())).toEqual({ status: 'no-write' });
    });

    it('describes an inverse that captures the current legacy VCA state', () => {
        mocks.captureLegacyVcaState.mockReturnValue({ vcaGroups: [{ id: 'vca-1' }] });

        const desc = handleRestoreLegacyVcaState.describe(action());

        expect(desc.label).toBe('Restore Legacy VCA State');
        expect(desc.inverseAction).toEqual({
            type: 'restoreLegacyVcaState',
            payload: { vcaGroups: [{ id: 'vca-1' }] },
        });
    });

    it('is undoable', () => {
        expect(handleRestoreLegacyVcaState.undoable).toBe(true);
    });
});
