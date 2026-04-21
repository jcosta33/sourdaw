import { macroStore } from '../../stores/macroStore';
import { generateGroupId } from '../commandQueries';

/**
 * Replay a saved macro by dispatching each action in sequence.
 * All actions share a single undo group so the entire macro can be
 * undone/redone as one atomic operation.
 * Uses dynamic import to avoid circular dependency with executeAppAction.
 */
export async function playMacro(macroId: string): Promise<void> {
    const state = macroStore.value;
    if (!state) {
        return;
    }

    const macro = state.macros.find((message) => message.id === macroId);
    if (!macro) {
        return;
    }

    const { executeAppAction } = await import('../executeAppAction');
    const { groupId, groupLabel } = generateGroupId(`Macro: ${macro.name}`);

    for (const action of macro.actions) {
        await executeAppAction(action, { groupId, groupLabel });
    }
}
