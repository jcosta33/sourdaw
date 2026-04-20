import { describe, it, expect, vi, beforeEach } from 'vitest';

import { revertAiActionGroup } from '../aiHistoryActions';

vi.mock('#/modules/Command/stores', () => ({
    undoStore: {
        value: {
            past: [
                {
                    id: 'u1',
                    kind: 'action' as const,
                    label: 'test',
                    timestamp: 0,
                    source: 'manual' as const,
                    groupId: 'g1',
                    action: { type: 'setTempo', payload: { bpm: 100 } },
                    inverseAction: { type: 'stopPlayback' },
                },
            ],
            future: [],
        },
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/AiRuntime/stores/aiActionHistoryStore', () => ({
    markGroupReverted: vi.fn(),
}));

describe('revertAiActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls executeAppAction for action entries with inverseAction', async () => {
        const { executeAppAction } = await import('#/modules/Command/useCases');
        const { markGroupReverted } = await import('#/modules/AiRuntime/stores/aiActionHistoryStore');

        await revertAiActionGroup({
            id: 'a1',
            prompt: 'p',
            actions: [],
            groupId: 'g1',
            timestamp: 0,
            reverted: false,
        });

        expect(executeAppAction).toHaveBeenCalledWith({ type: 'stopPlayback' });
        expect(markGroupReverted).toHaveBeenCalledWith('g1');
    });
});
