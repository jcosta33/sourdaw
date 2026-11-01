import { type ReadableStore } from '#/infra/store/types';

import { type UndoEntry, type UndoSource } from '../models/UndoEntry';
import { partitionUndoUnits, undoEntryLabel } from '../models/UndoUnit';

import { undoStore as mutable_undo_store, type UndoStoreState as MutableUndoStoreState } from './undoStore';

/** One undo step: everything a single undo or redo consumes. */
type UndoStep = {
    /** The id of the step's head entry: the entry undo or redo names it by. */
    readonly key: string;
    readonly label: string;
    readonly source: UndoSource;
    /** The `undoToIndex` target that leaves this step as the newest applied one. */
    readonly historyIndex: number;
};

export type UndoStepStoreState = {
    /** Applied steps, oldest first; the last is the one undo reverts next. */
    readonly pastSteps: readonly UndoStep[];
    /** Undone steps, next redo first. */
    readonly futureSteps: readonly UndoStep[];
};

let cached_mutable_snapshot: MutableUndoStoreState | null | undefined;
let cached_step_snapshot: UndoStepStoreState | null = null;

function to_step(head: UndoEntry, historyIndex: number): UndoStep {
    return Object.freeze({ key: head.id, label: undoEntryLabel(head), source: head.source, historyIndex });
}

/** Undo names a past step by its newest entry; reaching it keeps that entry applied. */
function to_past_steps(past: readonly UndoEntry[]): readonly UndoStep[] {
    return Object.freeze(partitionUndoUnits(past).map((unit) => to_step(past[unit.last]!, unit.last)));
}

/** Redo names a future step by its first entry; reaching it redoes through its last.
 *  `future[k]` sits at `past.length + k` in the history numbering `undoToIndex` reads. */
function to_future_steps(future: readonly UndoEntry[], past_count: number): readonly UndoStep[] {
    return Object.freeze(
        partitionUndoUnits(future).map((unit) => to_step(future[unit.first]!, past_count + unit.last))
    );
}

function to_step_snapshot(mutable_snapshot: MutableUndoStoreState | null): UndoStepStoreState | null {
    if (mutable_snapshot === cached_mutable_snapshot) {
        return cached_step_snapshot;
    }

    cached_mutable_snapshot = mutable_snapshot;
    cached_step_snapshot = mutable_snapshot
        ? Object.freeze({
              pastSteps: to_past_steps(mutable_snapshot.past),
              futureSteps: to_future_steps(mutable_snapshot.future, mutable_snapshot.past.length),
          })
        : null;
    return cached_step_snapshot;
}

/** The undo history as the user steps through it: one row per undo step, not per entry. */
export const undoStepStore: ReadableStore<UndoStepStoreState> = {
    get value() {
        return to_step_snapshot(mutable_undo_store.value);
    },

    subscribe(callback) {
        return mutable_undo_store.subscribe((value) => {
            callback(to_step_snapshot(value));
        });
    },

    subscribeReact(listener) {
        return mutable_undo_store.subscribeReact(listener);
    },

    getSnapshot() {
        return to_step_snapshot(mutable_undo_store.getSnapshot());
    },
};
