import { isRecord } from '#/utils/structuralEquality';

import { type ToolCallResult } from './toolCallParser';

/** The selective command may be named directly or inside a provider batch. */
export function containsMidiNoteEditCall(calls: readonly ToolCallResult[]): boolean {
    const namesEdit = (value: unknown) => isRecord(value) && value.name === 'editMidiNotes';
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
