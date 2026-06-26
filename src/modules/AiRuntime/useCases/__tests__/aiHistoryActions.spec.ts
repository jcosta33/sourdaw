import { describe, it, expect, vi, beforeEach } from 'vitest';

import { revertAiActionGroup } from '../aiHistoryActions';

vi.mock('#/modules/Command/useCases', () => ({
    revertActionGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/AiRuntime/stores/aiActionHistoryStore', () => ({
    markGroupReverted: vi.fn(),
}));

describe('revertAiActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the undo-store mutation to Command and marks the group reverted', async () => {
        const { revertActionGroup } = await import('#/modules/Command/useCases');
        const { markGroupReverted } = await import('#/modules/AiRuntime/stores/aiActionHistoryStore');

        await revertAiActionGroup({
            id: 'a1',
            prompt: 'p',
            actions: [],
            groupId: 'g1',
            timestamp: 0,
            reverted: false,
        });

        expect(revertActionGroup).toHaveBeenCalledWith('g1');
        expect(markGroupReverted).toHaveBeenCalledWith('g1');
    });
});
