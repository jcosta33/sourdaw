import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type UndoEntry, isActionEntry } from '../models/UndoEntry';

const logger = Container.getInstance().get(Logger);

const UNDO_SESSION_KEY = 'webdaw-undo-session';
const MAX_UNDO_PERSIST = 100;

export type UndoStoreState = {
    past: UndoEntry[];
    future: UndoEntry[];
};

function loadFromSession(): UndoStoreState {
    try {
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as UndoStoreState;
            if (Array.isArray(parsed.past) && Array.isArray(parsed.future)) {
                const ensureKind = (e: UndoEntry): UndoEntry => ({ ...e, kind: e.kind ?? 'action' }) as UndoEntry;
                return {
                    past: parsed.past.map(ensureKind),
                    future: parsed.future.map(ensureKind),
                };
            }
        }
    } catch {
        /* ignore */
    }
    return { past: [], future: [] };
}

export const undoStore = new Store<UndoStoreState>(logger, {
    initialData: loadFromSession(),
});

undoStore.subscribe((value) => {
    if (!value) {
        return;
    }
    try {
        const serializableOnly = (entries: UndoEntry[]) => entries.filter(isActionEntry).slice(-MAX_UNDO_PERSIST);
        const trimmed: UndoStoreState = {
            past: serializableOnly(value.past),
            future: serializableOnly(value.future),
        };
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(trimmed));
    } catch {
        /* storage full or unavailable */
    }
});

export function pushUndo(entry: UndoEntry): void {
    const state = undoStore.value;
    if (!state) {
        return;
    }
    undoStore.set({
        past: [...state.past, entry],
        future: [],
    });

    // Mirror into branching undo tree when enabled
    void import('../useCases/undoTreeUseCases').then(({ recordToTree }) => {
        recordToTree(entry);
    });
}
