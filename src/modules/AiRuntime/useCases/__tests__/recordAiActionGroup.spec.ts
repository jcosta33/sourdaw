import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AiActionGroup } from '../../stores/aiActionHistoryStore';
import { recordAiActionGroup } from '../recordAiActionGroup';

const module_mocks = vi.hoisted(() => ({
    push_ai_action_group: vi.fn<(group: AiActionGroup) => void>(),
}));

vi.mock('../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: module_mocks.push_ai_action_group,
}));

describe('recordAiActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should route action-history writes through the AiRuntime store helper', () => {
        const action_group: AiActionGroup = {
            id: 'group-1',
            prompt: 'make a lead track',
            actions: [
                {
                    kind: 'appAction',
                    actionType: 'track.add',
                    label: 'Add track',
                },
            ],
            groupId: 'group-1',
            timestamp: 1_720_000_000_000,
            reverted: false,
        };

        recordAiActionGroup(action_group);

        expect(module_mocks.push_ai_action_group).toHaveBeenCalledTimes(1);
        expect(module_mocks.push_ai_action_group).toHaveBeenCalledWith(action_group);
    });
});
