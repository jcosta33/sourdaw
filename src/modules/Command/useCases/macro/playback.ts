import { macroStore } from '../../stores/macroStore';

/**
 * Replay a saved macro by dispatching each action in sequence.
 * Uses dynamic import to avoid circular dependency with executeAppAction.
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

    // Dynamic import to break circular dependency
    const { executeAppAction } = await import('../executeAppAction');

    for (const action of macro.actions) {
        await executeAppAction(action);
    }
}
