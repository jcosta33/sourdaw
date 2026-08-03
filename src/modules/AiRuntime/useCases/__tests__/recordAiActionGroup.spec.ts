import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordAiActionGroup } from '../recordAiActionGroup';

type WrittenHistoryGroup = {
    id: string;
    prompt: string;
    actions: Array<{
        kind: 'appAction';
        actionType: string;
        label: string;
    }>;
    groupId: string;
    timestamp: number;
    reverted: boolean;
};

const module_mocks = vi.hoisted(() => ({
    push_ai_action_group: vi.fn<(group: WrittenHistoryGroup) => void>(),
}));

vi.mock('../../stores/aiActionHistoryStore', () => ({
    pushAiActionGroup: module_mocks.push_ai_action_group,
}));

describe('recordAiActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(Date, 'now').mockReturnValue(1_720_000_000_000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should build an AiRuntime history group before writing it to the store helper', () => {
        recordAiActionGroup({
            prompt: 'make a lead track',
            actions: [
                {
                    kind: 'appAction',
                    actionType: 'track.add',
                    label: 'Add track',
                },
            ],
            groupId: 'group-1',
        });

        expect(module_mocks.push_ai_action_group).toHaveBeenCalledTimes(1);
        expect(module_mocks.push_ai_action_group).toHaveBeenCalledWith({
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
        });
    });
});
