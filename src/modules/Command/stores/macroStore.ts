import { createStore } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { type Macro } from '../models/Macro';

const STORAGE_KEY = 'sourdaw:macros';

// Caps mirror undoStore's MAX_UNDO_PERSIST discipline (§85.2): an unbounded
// macro list (or a macro that captured a runaway recording) would let one
// localStorage write grow without limit and eventually throw QuotaExceeded.
// Persist at most MAX_MACROS, each truncated to MAX_MACRO_ACTIONS actions.
const MAX_MACROS = 100;
const MAX_MACRO_ACTIONS = 500;
const RETIRED_MACRO_ACTION_TYPES = new Set(['restoreDsoSnapshot']);

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

type UnknownRecord = {
    readonly [key: string]: unknown;
};

function isUnknownRecord(value: unknown): value is UnknownRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (Array.isArray(value)) {
        return false;
    }
    return true;
}

function hasPersistedActionShape(value: unknown): boolean {
    if (!isUnknownRecord(value)) {
        return false;
    }
    return typeof value.type === 'string' && !RETIRED_MACRO_ACTION_TYPES.has(value.type);
}

/** Shape-guard a parsed entry before trusting it as a `Macro` (mirrors undoStore's defensive load). */
function isMacro(value: unknown): value is Macro {
    if (!isUnknownRecord(value)) {
        return false;
    }
    return (
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.createdAt === 'number' &&
        Number.isFinite(value.createdAt) &&
        Array.isArray(value.actions) &&
        value.actions.every(hasPersistedActionShape)
    );
}

function loadPersistedMacros(): Macro[] {
    try {
        // eslint-disable-next-line no-restricted-syntax -- Macro storage is a legacy plain JSON array; createLocalStorage would rewrite it as SuperJSON.
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed: unknown = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                return parsed.filter(isMacro);
            }
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
            // eslint-disable-next-line no-restricted-syntax -- Preserve the legacy plain JSON macro array stored under this key.
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimMacrosForPersist(current.macros)));
        } catch {
            // Storage full — silently degrade
        }
    });
});
