import { type AiActionGroup, pushAiActionGroup } from '../stores/aiActionHistoryStore';

type RecordAiActionEntryInput = {
    kind: 'appAction';
    actionType: string;
    label: string;
};

type RecordAiActionGroupInput = {
    prompt: string;
    groupId: string;
    actions: RecordAiActionEntryInput[];
};

export function recordAiActionGroup(input: RecordAiActionGroupInput): void {
    const historyGroup: AiActionGroup = {
        id: input.groupId,
        prompt: input.prompt,
        actions: input.actions,
        groupId: input.groupId,
        timestamp: Date.now(),
        reverted: false,
    };

    pushAiActionGroup(historyGroup);
}
