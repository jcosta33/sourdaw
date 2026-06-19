import { createStore } from '#/infra/store/createStore';

import { type Macro } from '../models/Macro';
import { type AppAction } from '../useCases/commandQueries';

const STORAGE_KEY = 'sourdaw:macros';

// Caps mirror undoStore's MAX_UNDO_PERSIST discipline (§85.2): an unbounded
// macro list (or a macro that captured a runaway recording) would let one
// localStorage write grow without limit and eventually throw QuotaExceeded.
// Persist at most MAX_MACROS, each truncated to MAX_MACRO_ACTIONS actions.
const MAX_MACROS = 100;
const MAX_MACRO_ACTIONS = 500;

/** Trim the macro list for persistence: keep the most recent macros and cap each one's action count. */
function trimMacrosForPersist(macros: Macro[]): Macro[] {
    return macros
        .slice(-MAX_MACROS)
        .map((macro) =>
            macro.actions.length > MAX_MACRO_ACTIONS
                ? { ...macro, actions: macro.actions.slice(-MAX_MACRO_ACTIONS) }
                : macro
        );
}

export type MacroStoreState = {
    macros: Macro[];
    recording: boolean;
    currentRecording: AppAction[];
};

function loadPersistedMacros(): Macro[] {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored) as Macro[];
        }
    } catch {
        // Fallback to empty
    }
    return [];
}

export const macroStore = createStore<MacroStoreState>({
    initialData: { macros: loadPersistedMacros(), recording: false, currentRecording: [] },
});

// Coalesce persistence writes (mirrors undoStore §85.2): before this, every
// mutation — including each `currentRecording` push while recording — triggered
// an immediate full JSON.stringify(macros) + localStorage write, producing O(N)
// writes during a recording session. We now (1) skip writes while recording,
// since the persisted shape only covers `macros` (recording state is transient),
// and (2) defer the write to a microtask flush so successive committing
// mutations in the same turn produce exactly one serialize.
let flushScheduled = false;
macroStore.subscribe((value) => {
    if (!value || value.recording || flushScheduled) {
        return;
    }
    flushScheduled = true;
    queueMicrotask(() => {
        flushScheduled = false;
        const current = macroStore.value;
        if (!current || current.recording) {
            return;
        }
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimMacrosForPersist(current.macros)));
        } catch {
            // Storage full — silently degrade
        }
    });
});
