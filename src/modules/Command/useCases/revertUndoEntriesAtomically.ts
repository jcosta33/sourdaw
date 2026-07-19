import { type AppAction } from '#/utils/handlerContract';

import { type UndoEntry } from '../models/UndoEntry';

import { executeAppAction } from './executeAppAction';

const replay_options = { skipUndo: true, skipMacroRecording: true } as const;

async function apply_inverse(entry: UndoEntry): Promise<void> {
    if (entry.kind === 'callback') {
        entry.undo();
        return;
    }
    if (entry.inverseAction) {
        await executeAppAction(entry.inverseAction, replay_options);
    }
}

function create_adjustment_aggregate_inverse(entries: readonly UndoEntry[]): AppAction | null {
    const mutations: Array<Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>['payload']> = [];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreAdjustmentLayerMutation') {
            return null;
        }
        mutations.push(entry.inverseAction.payload);
    }
    return { type: 'restoreAdjustmentLayerMutationBatch', payload: { mutations } };
}

/**
 * Revert only when one handler owns the whole observable mutation. A single
 * entry is already owned by its handler; multi-entry adjustment groups converge
 * onto one aggregate inverse that preflights every operation before one store batch.
 * Other multi-entry groups are refused before any inverse can become observable.
 */
export async function revertUndoEntriesAtomically(entries: readonly UndoEntry[]): Promise<boolean> {
    if (entries.length === 0) {
        return false;
    }

    if (entries.length === 1) {
        const entry = entries[0]!;
        if (entry.kind === 'action' && !entry.inverseAction) {
            return false;
        }
        await apply_inverse(entry);
        return true;
    }

    const aggregate_inverse = create_adjustment_aggregate_inverse(entries);
    if (!aggregate_inverse) {
        return false;
    }
    await executeAppAction(aggregate_inverse, replay_options);

    return true;
}
