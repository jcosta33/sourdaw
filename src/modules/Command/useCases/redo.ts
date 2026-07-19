import {
    type AdjustmentLayerMutationAction,
    type AppAction,
    type HandlerDescribeResult,
} from '#/utils/handlerContract';

import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { recordAction } from './macro/recording/recordAction';
import { REDO_NOT_APPLIED } from './redoResult';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

const adjustment_layer_mutation_types = new Set<AppAction['type']>([
    'createAdjustmentLayer',
    'removeAdjustmentLayer',
    'toggleAdjustmentLayer',
    'setLayerParameter',
    'setLayerMix',
    'addAdjustmentRegion',
    'removeAdjustmentRegion',
    'moveAdjustmentRegion',
    'setLayerFades',
    'setLayerAffectedTracks',
    'setLayerInsertionIndex',
]);

function is_adjustment_layer_mutation(action: AppAction): action is AdjustmentLayerMutationAction {
    return adjustment_layer_mutation_types.has(action.type);
}

async function replay_adjustment_transaction(entries: readonly UndoEntry[]): Promise<UndoEntry[] | null> {
    const actions: AdjustmentLayerMutationAction[] = [];
    for (const entry of entries) {
        if (entry.kind !== 'action' || !is_adjustment_layer_mutation(entry.action)) {
            return null;
        }
        actions.push(entry.action);
    }
    let inverse_actions: AppAction[] | undefined;
    await executeAppAction(
        { type: 'applyAdjustmentLayerMutationBatch', payload: { actions } },
        {
            skipUndo: true,
            skipMacroRecording: true,
            onExecuted: (result) => {
                inverse_actions = result.inverseActions;
            },
        }
    );
    if (!inverse_actions || inverse_actions.length !== entries.length) {
        throw new Error('Adjustment-layer batch redo did not prepare a complete inverse');
    }
    for (const action of actions) {
        recordAction(action);
    }
    return entries.map((entry, index) => {
        if (entry.kind !== 'action') {
            return entry;
        }
        return { ...entry, inverseAction: inverse_actions?.[index] ?? null };
    });
}

async function executeRedo(entry: UndoEntry): Promise<UndoEntry | null> {
    if (entry.kind === 'callback') {
        return entry.redo() !== REDO_NOT_APPLIED ? entry : null;
    }
    const prepared_undo: { result: HandlerDescribeResult | null } = { result: null };
    await executeAppAction(entry.action, {
        skipUndo: true,
        onUndoPrepared: (result) => {
            prepared_undo.result = result;
        },
    });
    return {
        ...entry,
        label: prepared_undo.result?.label ?? entry.label,
        inverseAction: prepared_undo.result?.inverseAction ?? null,
    };
}

async function redoImpl(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.future.length === 0) {
        return;
    }

    const entry = state.future[0]!;

    if (entry.transactionGroupId) {
        const group_entries: UndoEntry[] = [];
        let group_end = 0;
        while (
            group_end < state.future.length &&
            state.future[group_end]!.transactionGroupId === entry.transactionGroupId
        ) {
            group_entries.push(state.future[group_end]!);
            group_end += 1;
        }
        const redone_group = group_entries.length > 1 ? await replay_adjustment_transaction(group_entries) : null;
        if (redone_group) {
            const new_past = [...state.past, ...redone_group];
            undoStore.set({ past: new_past, future: state.future.slice(group_end) });
            undoTreeMoveTo(currentEntryId(new_past));
            return;
        }
    }

    const newFuture = state.future.slice(1);

    const redone_entry = await executeRedo(entry);
    if (!redone_entry) {
        return;
    }

    const newPast = [...state.past, redone_entry];
    undoStore.set({
        past: newPast,
        future: newFuture,
    });
    undoTreeMoveTo(currentEntryId(newPast));
}

export function redo(): Promise<void> {
    return runUndoRedoExclusive(redoImpl);
}
