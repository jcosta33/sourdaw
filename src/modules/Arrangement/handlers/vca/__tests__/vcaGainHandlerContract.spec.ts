import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSetVcaGain } from '../handleSetVcaGain';

const mocks = vi.hoisted(() => ({
    captureLegacyVcaState: vi.fn(),
    getVcaGroupsState: vi.fn(),
    setVcaGain: vi.fn(),
    toVcaGainExecutionResult: vi.fn(),
}));

vi.mock('../../../stores/vcaGroupStore', () => ({ getVcaGroupsState: mocks.getVcaGroupsState }));
vi.mock('../../../useCases/vca/captureLegacyVcaState', () => ({
    captureLegacyVcaState: mocks.captureLegacyVcaState,
}));
vi.mock('../../../useCases/vca/setVcaGain', () => ({ setVcaGain: mocks.setVcaGain }));
vi.mock('../toVcaGainExecutionResult', () => ({ toVcaGainExecutionResult: mocks.toVcaGainExecutionResult }));

const inversePayload = {
    groupRows: [],
    groupGains: [{ groupId: 'vca-drums', expectedGain: 0.65, replacementGain: 0.75 }],
    groupMemberships: [],
    trackMemberships: [],
};
const redoPayload = {
    groupRows: [],
    groupGains: [{ groupId: 'vca-drums', expectedGain: 0.75, replacementGain: 0.65 }],
    groupMemberships: [],
    trackMemberships: [],
};

describe('handleSetVcaGain contract', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.captureLegacyVcaState.mockReturnValueOnce(inversePayload).mockReturnValueOnce(redoPayload);
        mocks.getVcaGroupsState.mockReturnValue([
            { id: 'vca-drums', name: 'Drums', gain: 0.75, muted: false, trackIds: ['track-kick'] },
        ]);
        mocks.setVcaGain.mockReturnValue(true);
        mocks.toVcaGainExecutionResult.mockReturnValue({ status: 'written' });
    });

    it('captures guarded internal undo and redo actions', () => {
        const action = { type: 'setVcaGain', payload: { vcaGroupId: 'vca-drums', gain: 0.65 } } as const;

        expect(handleSetVcaGain.describe(action)).toEqual({
            label: 'Set VCA Gain',
            inverseAction: { type: 'restoreLegacyVcaState', payload: inversePayload },
            redoAction: { type: 'restoreLegacyVcaState', payload: redoPayload },
        });
        expect(mocks.captureLegacyVcaState).toHaveBeenNthCalledWith(1, action);
        expect(mocks.captureLegacyVcaState).toHaveBeenNthCalledWith(2, {
            type: 'restoreLegacyVcaState',
            payload: inversePayload,
        });
    });

    it('returns post-commit runtime work only after a durable write', () => {
        const action = { type: 'setVcaGain', payload: { vcaGroupId: 'vca-drums', gain: 0.65 } } as const;

        expect(handleSetVcaGain.execute(action)).toEqual({ status: 'written' });
        expect(mocks.setVcaGain).toHaveBeenCalledWith('vca-drums', 0.65);
        expect(mocks.toVcaGainExecutionResult).toHaveBeenCalledWith({
            groupIds: ['vca-drums'],
            status: 'written',
        });
    });

    it('recognizes only an exact existing-group no-op', () => {
        expect(
            handleSetVcaGain.isNoop?.({ type: 'setVcaGain', payload: { vcaGroupId: 'vca-drums', gain: 0.75 } })
        ).toBe(true);
        expect(handleSetVcaGain.isNoop?.({ type: 'setVcaGain', payload: { vcaGroupId: 'missing', gain: 0.75 } })).toBe(
            false
        );
        mocks.getVcaGroupsState.mockReturnValue([
            { id: 'vca-drums', name: 'Drums', gain: 0, muted: false, trackIds: ['track-kick'] },
        ]);
        expect(handleSetVcaGain.isNoop?.({ type: 'setVcaGain', payload: { vcaGroupId: 'vca-drums', gain: -0 } })).toBe(
            true
        );
    });
});
