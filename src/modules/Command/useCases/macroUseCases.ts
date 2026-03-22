/**
 * Macro Use Cases.
 *
 * Record sequences of AppActions, save as named macros, and replay them.
 * Photoshop-style action recording and playback.
 */

import { macroStore } from '../stores/macroStore';
import { type AppAction } from '../models/AppAction';
import { type Macro } from '../models/Macro';

// Re-export for cross-module use
export type { Macro } from '../models/Macro';

// ── Recording ─────────────────────────────────────────────────────────

/** Actions that should NOT be recorded inside a macro (meta-actions). */
const EXCLUDED_ACTIONS = new Set([
    'startMacroRecording',
    'stopMacroRecording',
    'playMacro',
    'deleteMacro',
]);

export function startMacroRecording(): void {
    const state = macroStore.value;
    if (!state || state.recording) {
        return;
    }
    macroStore.set({ ...state, recording: true, currentRecording: [] });
}

export function stopMacroRecording(name: string): void {
    const state = macroStore.value;
    if (!state || !state.recording) {
        return;
    }

    const macro: Macro = {
        id: `macro-${crypto.randomUUID().slice(0, 8)}`,
        name: name.trim() || `Macro ${state.macros.length + 1}`,
        actions: [...state.currentRecording],
        createdAt: Date.now(),
    };

    macroStore.set({
        macros: [...state.macros, macro],
        recording: false,
        currentRecording: [],
    });
}

/**
 * Called from executeAppAction dispatch to capture actions during recording.
 * Filters out meta-actions (recording/playback commands).
 */
export function recordAction(action: AppAction): void {
    const state = macroStore.value;
    if (!state || !state.recording) {
        return;
    }
    if (EXCLUDED_ACTIONS.has(action.type)) {
        return;
    }
    macroStore.set({
        ...state,
        currentRecording: [...state.currentRecording, action],
    });
}

export function isRecording(): boolean {
    return macroStore.value?.recording ?? false;
}

// ── Playback ──────────────────────────────────────────────────────────

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
    const { executeAppAction } = await import('../useCases/executeAppAction');

    for (const action of macro.actions) {
        await executeAppAction(action);
    }
}

// ── CRUD ──────────────────────────────────────────────────────────────

export function deleteMacro(macroId: string): void {
    const state = macroStore.value;
    if (!state) {
        return;
    }
    macroStore.set({
        ...state,
        macros: state.macros.filter((m) => m.id !== macroId),
    });
}

export function renameMacro(macroId: string, name: string): void {
    const state = macroStore.value;
    if (!state) {
        return;
    }
    macroStore.set({
        ...state,
        macros: state.macros.map((m) => (m.id === macroId ? { ...m, name } : m)),
    });
}

export function getMacros(): Macro[] {
    return macroStore.value?.macros ?? [];
}
