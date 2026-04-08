import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { revertAiActionGroup } from './aiHistoryActions';

describe('revertAiActionGroup', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('calls executeAppAction for action entries with inverseAction', async () => {
        const executeAppAction = vi.fn().mockResolvedValue(undefined);
        const markGroupReverted = vi.fn();
        const undoStore = {
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
        };
        injectDependencies(revertAiActionGroup, { executeAppAction, undoStore, markGroupReverted });

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
