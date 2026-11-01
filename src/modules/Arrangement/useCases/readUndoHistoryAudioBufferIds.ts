import { undoHistoryStore, type UndoHistoryStoreState } from '#/modules/Command/stores';

import { collectAudioBufferIdFields } from './collectAudioBufferIdFields';

type UndoHistoryEntry = UndoHistoryStoreState['past'][number];
type ActionUndoHistoryEntry = Extract<UndoHistoryEntry, { kind: 'action' }>;

type EntryBufferIds = {
    readonly actions: readonly unknown[];
    readonly ids: readonly string[];
};

const bufferIdsByEntry = new WeakMap<ActionUndoHistoryEntry, EntryBufferIds>();

function hasSameActions(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((action, index) => action === right[index]);
}

/** An action entry's ids, walked once and reused until one of its actions is
 * replaced: a redo installs a freshly captured inverse onto its entry in place
 * (`commitRedoInverseCapture`) without publishing a new store value. */
function readActionEntryBufferIds(entry: ActionUndoHistoryEntry): readonly string[] {
    const actions = [entry.action, entry.inverseAction, entry.redoAction];
    const cached = bufferIdsByEntry.get(entry);
    if (cached && hasSameActions(cached.actions, actions)) {
        return cached.ids;
    }
    const ids = collectAudioBufferIdFields(actions);
    bufferIdsByEntry.set(entry, { actions, ids });
    return ids;
}

/** A callback's closures cannot be read, so its producer declares the buffers
 * they restore (`restoresBufferIds`). */
function readEntryBufferIds(entry: UndoHistoryEntry): readonly string[] {
    if (entry.kind === 'callback') {
        return entry.restoresBufferIds ?? [];
    }
    return readActionEntryBufferIds(entry);
}

/**
 * Every audio buffer id an undo or redo could bring back into the arrangement:
 * each action entry's forward, inverse and redo actions on both stacks, walked
 * by field name so an action type added later is covered, plus each callback
 * entry's declared ids. An entry that leaves the history (cleared on a project
 * change, dropped from `future` by a new edit) stops contributing.
 *
 * The branching undo tree is not read: switching to a branch off the current
 * past/future path records a selection only and replays nothing
 * (`switchBranch`), so its entries cannot restore a clip.
 */
export function readUndoHistoryAudioBufferIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    const state = undoHistoryStore.value;
    if (!state) {
        return ids;
    }
    for (const entry of [...state.past, ...state.future]) {
        for (const id of readEntryBufferIds(entry)) {
            ids.add(id);
        }
    }
    return ids;
}
