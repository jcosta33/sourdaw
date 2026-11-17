import { isRecord } from '#/utils/structuralEquality';

import { type ToolCallResult } from './toolCallParser';

function namesEdit(value: unknown): boolean {
    return isRecord(value) && value.name === 'editMidiNotes';
}

/** The selective command may be named directly or inside a provider batch. */
export function containsMidiNoteEditCall(calls: readonly ToolCallResult[]): boolean {
    return calls.some((call) => {
        if (call.name === 'editMidiNotes') {
            return true;
        }
        if (call.name !== 'command.batch.propose') {
            return false;
        }
        const { commands, list } = call.arguments;
        return (
            (Array.isArray(commands) && commands.some(namesEdit)) ||
            (isRecord(list) && Array.isArray(list.items) && list.items.some(namesEdit))
        );
    });
}
