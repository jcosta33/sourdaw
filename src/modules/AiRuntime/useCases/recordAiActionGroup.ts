import { type AiActionGroup, pushAiActionGroup } from '../stores/aiActionHistoryStore';

type RecordAiActionGroupInput = AiActionGroup;

export function recordAiActionGroup(input: RecordAiActionGroupInput): void {
    pushAiActionGroup(input);
}
