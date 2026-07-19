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

async function replayAdjustmentTransaction(
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
    const preparedUndo: { result: HandlerDescribeResult | null } = { result: null };
    await executeAppActionImpl(
        entry.action,
        {
            skipUndo: true,
            onUndoPrepared: (result) => {
                preparedUndo.result = result;
            },
        },
        owner
    );
    return {
        ...entry,
        label: preparedUndo.result?.label ?? entry.label,
        inverseAction: preparedUndo.result?.inverseAction ?? null,
    };
}

/** Execute one redo while the caller already owns the Command mutation lease. */
export async function redoUnderMutation(owner?: CommandMutationOwner): Promise<void> {
    const mutationOwner = owner ?? commandMutationRuntime.synchronousOwner ?? commandMutationRuntime.activeOwner;
    if (!mutationOwner) {
        throw new Error('Redo requires an active Command mutation owner');
    }
    const state = undoStore.value;
    if (!state || state.future.length === 0) {
        return;
    }

    const entry = state.future[0]!;

    if (entry.transactionGroupId) {
        const groupEntries: UndoEntry[] = [];
        let groupEnd = 0;
        while (
            groupEnd < state.future.length &&
            state.future[groupEnd]!.transactionGroupId === entry.transactionGroupId
        ) {
            groupEntries.push(state.future[groupEnd]!);
            groupEnd += 1;
        }
        let redoneGroup: UndoEntry[] | null = null;
        if (groupEntries.length > 1) {
            redoneGroup = await replayAdjustmentTransaction(mutationOwner, groupEntries);
        }
        if (redoneGroup) {
            const newPast = [...state.past, ...redoneGroup];
            undoStore.set({ past: newPast, future: state.future.slice(groupEnd) });
            undoTreeMoveTo(currentEntryId(newPast));
            return;
        }
    }

    const newFuture = state.future.slice(1);

    const redoneEntry = await executeRedo(mutationOwner, entry);
    if (!redoneEntry) {
        return;
    }

    const newPast = [...state.past, redoneEntry];
    undoStore.set({
        past: newPast,
        future: newFuture,
    });
    undoTreeMoveTo(currentEntryId(newPast));
}
