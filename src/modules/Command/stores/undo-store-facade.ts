import { type ReadableStore } from '#/infra/store/types';

import { type UndoEntry } from '../models/UndoEntry';

import { undoStore as mutable_undo_store, type UndoStoreState as MutableUndoStoreState } from './undoStore';

export type UndoStoreEntry = {
    readonly label: string;
};

export type UndoStoreState = {
    readonly past: readonly UndoStoreEntry[];
    readonly future: readonly UndoStoreEntry[];
};

let cached_mutable_snapshot: MutableUndoStoreState | null | undefined;
let cached_readonly_snapshot: UndoStoreState | null = null;

function freeze_entries(entries: UndoEntry[]): readonly UndoStoreEntry[] {
    return Object.freeze(entries.map((entry) => Object.freeze({ label: entry.label })));
}

function to_readonly_snapshot(mutable_snapshot: MutableUndoStoreState | null): UndoStoreState | null {
    if (mutable_snapshot === cached_mutable_snapshot) {
        return cached_readonly_snapshot;
    }

    cached_mutable_snapshot = mutable_snapshot;
    cached_readonly_snapshot = mutable_snapshot
        ? Object.freeze({
              past: freeze_entries(mutable_snapshot.past),
              future: freeze_entries(mutable_snapshot.future),
          })
        : null;
    return cached_readonly_snapshot;
}

export const undoStore: ReadableStore<UndoStoreState> = {
    get value() {
        return to_readonly_snapshot(mutable_undo_store.value);
    },

    subscribe(callback) {
        return mutable_undo_store.subscribe((value) => {
            callback(to_readonly_snapshot(value));
        });
    },

    subscribeReact(listener) {
        return mutable_undo_store.subscribeReact(listener);
    },

    getSnapshot() {
        return to_readonly_snapshot(mutable_undo_store.getSnapshot());
    },
};
