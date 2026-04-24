import { macroStore } from '../../stores/macroStore';
import { generateGroupId } from '../commandQueries';
import { executeAppAction } from '../executeAppAction';

/**
 * Replay a saved macro by dispatching each action in sequence.
 * All actions share a single undo group so the entire macro can be
 * undone/redone as one atomic operation.
 */
export async function playMacro(macroId: string): Promise<void> {
    const state = macroStore.value;
    if (!state) {
        return;
    }

    const macro = state.macros.find((m) => m.id === macroId);
    if (!macro) {
        return;
    }

    const { groupId, groupLabel } = generateGroupId(`Macro: ${macro.name}`);

    for (const action of macro.actions) {
        await executeAppAction(action, { groupId, groupLabel });
    }
}
