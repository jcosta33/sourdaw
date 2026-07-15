import { beforeEach, describe, expect, it, vi } from 'vitest';

import { revertAction } from '../revertAction';

const mocks = vi.hoisted(() => ({
    actionHistoryStoreValue: {
        value: {
            entries: [
                {
                    id: 'history-1',
                    label: 'Set value',
                    actionKind: 'setValue',
                    action: {
                        type: 'setDeviceParameter',
                        payload: { deviceId: 'device-1', paramId: 'gain', value: 1 },
                    },
                    inverseAction: {
                        type: 'setDeviceParameter',
                        payload: { deviceId: 'device-1', paramId: 'gain', value: 0.5 },
                    },
                    source: 'manual' as const,
                    timestamp: 0,
                    reverted: false,
                },
            ],
        } as import('../../../stores/actionHistoryStore').ActionHistoryState | null,
    },
    executeAppAction: vi.fn<typeof import('#/modules/Command/useCases').executeAppAction>(),
    markEntryReverted: vi.fn<(entryId: string) => void>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../../../stores/actionHistoryStore', () => ({
    actionHistoryStore: {
        get value() {
            return mocks.actionHistoryStoreValue.value;
        },
    },
    markEntryReverted: mocks.markEntryReverted,
}));

describe('revertAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('suppresses macro recording for a compensating inverse without suppressing its history semantics', async () => {
        await expect(revertAction('history-1')).resolves.toBe(true);

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            {
                type: 'setDeviceParameter',
                payload: { deviceId: 'device-1', paramId: 'gain', value: 0.5 },
            },
            {
                source: 'manual',
                groupLabel: 'Reverted: Set value',
                skipMacroRecording: true,
            }
        );
        expect(mocks.markEntryReverted).toHaveBeenCalledWith('history-1');
    });
});
