import {
    type AdjustmentLayerMutationAction,
    type AppAction,
    type HandlerDescribeResult,
} from '#/utils/handlerContract';

import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { type CommandMutationOwner } from './commandMutationOwner';
import { commandMutationRuntime } from './commandMutationRuntime';
import { executeAppActionImpl } from './executeAppActionImpl';
import { recordAction } from './macro/recording/recordAction';
import { REDO_NOT_APPLIED } from './redoResult';
import { runCommandHistoryReplay } from './runCommandHistoryReplay';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

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

async function replay_adjustment_transaction(
    owner: CommandMutationOwner,
    entries: readonly UndoEntry[]
): Promise<UndoEntry[] | null> {
    const actions: AdjustmentLayerMutationAction[] = [];
    for (const entry of entries) {
        if (entry.kind !== 'action' || !is_adjustment_layer_mutation(entry.action)) {
            return null;
        }
        actions.push(entry.action);
    }
    let inverse_actions: AppAction[] | undefined;
    await executeAppActionImpl(
        { type: 'applyAdjustmentLayerMutationBatch', payload: { actions } },
        {
            skipUndo: true,
            skipMacroRecording: true,
            onExecuted: (result) => {
                inverse_actions = result.inverseActions;
            },
        },
        owner
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

async function executeRedo(owner: CommandMutationOwner, entry: UndoEntry): Promise<UndoEntry | null> {
    if (entry.kind === 'callback') {
        const result = await runCommandHistoryReplay(owner, entry.redo);
        return result !== REDO_NOT_APPLIED ? entry : null;
    }
    const prepared_undo: { result: HandlerDescribeResult | null } = { result: null };
    await executeAppActionImpl(
        entry.action,
        {
            skipUndo: true,
            onUndoPrepared: (result) => {
                prepared_undo.result = result;
            },
        },
        owner
    );
    return {
        ...entry,
        label: prepared_undo.result?.label ?? entry.label,
        inverseAction: prepared_undo.result?.inverseAction ?? null,
    };
}

/** Execute one redo while the caller already owns the Command mutation lease. */
export async function redoUnderMutation(owner?: CommandMutationOwner): Promise<void> {
    const mutation_owner = owner ?? commandMutationRuntime.synchronousOwner ?? commandMutationRuntime.activeOwner;
    if (!mutation_owner) {
        throw new Error('Redo requires an active Command mutation owner');
    }
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
        let redone_group: UndoEntry[] | null = null;
        if (group_entries.length > 1) {
            redone_group = await replay_adjustment_transaction(mutation_owner, group_entries);
        }
        if (redone_group) {
            const new_past = [...state.past, ...redone_group];
            undoStore.set({ past: new_past, future: state.future.slice(group_end) });
            undoTreeMoveTo(currentEntryId(new_past));
            return;
        }
    }

    const newFuture = state.future.slice(1);

    const redone_entry = await executeRedo(mutation_owner, entry);
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
