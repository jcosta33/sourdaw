import { undoStore } from '../stores/undoStore';

import { type UndoEntry } from './commandQueries';
import { executeAppAction } from './executeAppAction';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty — i.e. the
 *  tree node the user is currently "at". Mirrored onto the undo tree's `currentNodeId`
 *  so a subsequent commit parents off the real position rather than the last-pushed
 *  node. See `undoTreeMoveTo`. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

/**
 * Performs the undo side-effect for one entry and reports whether anything was
 * actually undone. An `action` entry with no `inverseAction` cannot be undone — the
 * caller must NOT consume such an entry (move it past→future), or the undo stack
 * desyncs from real state: the user's undo would be a silent no-op while a later redo
 * re-executes the action, double-applying it. Returning `false` lets the caller leave
 * the entry in place so the failure surfaces instead of being masked.
 */
async function executeUndo(entry: UndoEntry, runExecuteAppAction: typeof executeAppAction): Promise<boolean> {
    if (entry.kind === 'callback') {
        entry.undo();
        return true;
    }
    if (entry.inverseAction) {
        // `skipUndo: true` is load-bearing: the inverse is a replay driven by the undo
        // engine, NOT a fresh user edit. Without it the inverse commits its own undo
        // entry mid-loop, which (a) pollutes the past/future stacks with synthetic
        // entries and (b) invalidates the `state` snapshot the caller captured before
        // the loop, so the finalizer writes a stale past/future. See `undo`.
        await runExecuteAppAction(entry.inverseAction, { skipUndo: true });
        return true;
    }
    return false;
}

async function executeRedo(entry: UndoEntry, runExecuteAppAction: typeof executeAppAction): Promise<void> {
    if (entry.kind === 'callback') {
        entry.redo();
    } else {
        await runExecuteAppAction(entry.action);
    }
}

/**
 * In-flight guard. `undo`/`redo` read `undoStore.value` up front and write the moved
 * stacks at the end; the `await` on the inverse/forward replay in between yields the
 * microtask queue. Without serialization two overlapping `undo()` calls both read the
 * same `state`, both pop the same `lastEntry`, and the second write clobbers the first —
 * the same entry is consumed twice and one document mutation is undone without its stack
 * bookkeeping. We serialize every mutation through one FIFO promise chain so a second
 * call only reads `undoStore.value` after the first has committed its write. Sequential
 * awaited callers (e.g. `undoToIndex`) still proceed one step at a time.
 */
let mutationChain: Promise<void> = Promise.resolve();

function runExclusive(operation: () => Promise<void>): Promise<void> {
    const result = mutationChain.then(operation);
    // Keep the chain alive even if an operation rejects, so one failure does not wedge
    // every future undo/redo. Swallow only on the chain copy; the caller still sees the
    // rejection via `result`.
    mutationChain = result.catch(() => undefined);
    return result;
}

async function undoImpl(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.past.length === 0) {
        return;
    }

    const lastEntry = state.past[state.past.length - 1]!;

    if (lastEntry.groupId) {
        const groupEntries: typeof state.past = [];
        let index = state.past.length - 1;
        while (index >= 0 && state.past[index]!.groupId === lastEntry.groupId) {
            groupEntries.unshift(state.past[index]!);
            index--;
        }
        const newPast = state.past.slice(0, index + 1);

        let anyUndone = false;
        for (let jIndex = groupEntries.length - 1; jIndex >= 0; jIndex--) {
            const undone = await executeUndo(groupEntries[jIndex]!, executeAppAction);
            anyUndone = anyUndone || undone;
        }

        // If no member of the group could be undone, the operation was inert — leave the
        // group in `past` rather than silently consuming it (which would let a later redo
        // re-apply the actions). See executeUndo.
        if (!anyUndone) {
            return;
        }

        undoStore.set({
            past: newPast,
            future: [...groupEntries, ...state.future],
        });
        undoTreeMoveTo(currentEntryId(newPast));
        return;
    }

    const undone = await executeUndo(lastEntry, executeAppAction);
    // An inert undo (no inverse, no callback) must not consume the entry — doing so
    // desyncs the stack from real state. See executeUndo.
    if (!undone) {
        return;
    }

    const newPast = state.past.slice(0, -1);
    undoStore.set({
        past: newPast,
        future: [lastEntry, ...state.future],
    });
    undoTreeMoveTo(currentEntryId(newPast));
}

async function redoImpl(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.future.length === 0) {
        return;
    }

    const entry = state.future[0]!;
    const newFuture = state.future.slice(1);

    await executeRedo(entry, executeAppAction);

    const newPast = [...state.past, entry];
    undoStore.set({
        past: newPast,
        future: newFuture,
    });
    undoTreeMoveTo(currentEntryId(newPast));
}

export function undo(): Promise<void> {
    return runExclusive(undoImpl);
}

export function redo(): Promise<void> {
    return runExclusive(redoImpl);
}

export async function undoToIndex(targetIndex: number): Promise<void> {
    const state = undoStore.value;
    if (!state) {
        return;
    }

    const currentIndex = state.past.length - 1;
    if (targetIndex === currentIndex) {
        return;
    }

    if (targetIndex < currentIndex) {
        const stepsBack = currentIndex - targetIndex;
        for (let index = 0; index < stepsBack; index++) {
            await undo();
        }
    } else {
        const stepsForward = targetIndex - currentIndex;
        for (let index = 0; index < stepsForward; index++) {
            await redo();
        }
    }
}
