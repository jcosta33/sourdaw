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
        payload: { groupRows: [], groupGains: [], groupMemberships: [], trackMemberships: [] },
    };
}

describe('handleRestoreLegacyVcaState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.captureLegacyVcaState.mockReturnValue({ captured: true });
    });

    it('reports a written status when the restore succeeds', () => {
        mocks.restoreLegacyVcaState.mockReturnValue('written');

        expect(handleRestoreLegacyVcaState.execute(action())).toMatchObject({
            status: 'written',
            afterCommit: expect.any(Function),
            afterAmbiguousCommit: expect.any(Function),
        });
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
