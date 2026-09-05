import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deleteYeastGrooveTemplate } from '../deleteYeastGrooveTemplate';
import { renameYeastGrooveTemplate } from '../renameYeastGrooveTemplate';
import { setYeastGrooveTemplate } from '../setYeastGrooveTemplate';

const userDispatch = vi.hoisted(() => vi.fn((): Promise<void> => Promise.resolve()));

const store = vi.hoisted(() => ({
    value: {
        processors: [
            {
                id: 'groove-1',
                type: 'groove' as const,
                name: 'Groove',
                bypassed: false,
                params: { amount: 0.4 },
            },
        ],
        uiLevel: 2 as const,
    },
    set: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: userDispatch,
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getScopedGrooveConsumerId: vi.fn(() => 'scoped-consumer-1'),
}));

vi.mock('../../stores/yeastStore', () => ({ yeastStore: store }));

vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeProjection: vi.fn(),
}));

vi.mock('../createYeastRuntimeProjection', () => ({
    createYeastRuntimeProjection: vi.fn(() => []),
}));

vi.mock('../getYeastGrooveAssignment', () => ({
    getYeastGrooveAssignment: vi.fn(() => undefined),
    YEAST_GROOVE_OWNER_ID: 'yeast-groove-owner',
}));

describe('Yeast groove template route dispatch seam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('assigns a template through the user dispatch wrapper', async () => {
        await setYeastGrooveTemplate('groove-1', 'template-9');

        expect(userDispatch).toHaveBeenCalledExactlyOnceWith({
            type: 'assignGrooveTemplate',
            payload: {
                consumerType: 'yeast-processor',
                consumerId: 'scoped-consumer-1',
                templateId: 'template-9',
                amount: 0.4,
            },
        });
    });

    it('deletes a template through the user dispatch wrapper', async () => {
        await deleteYeastGrooveTemplate('template-9');

        expect(userDispatch).toHaveBeenCalledExactlyOnceWith({
            type: 'deleteGrooveTemplate',
            payload: { templateId: 'template-9' },
        });
    });

    it('renames a template through the user dispatch wrapper', async () => {
        await renameYeastGrooveTemplate('template-9', 'Pocket Groove');

        expect(userDispatch).toHaveBeenCalledExactlyOnceWith({
            type: 'renameGrooveTemplate',
            payload: { templateId: 'template-9', name: 'Pocket Groove' },
        });
    });
});
