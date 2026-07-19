import { type UndoEntry } from '../models/UndoEntry';

import { executeAppAction } from './executeAppAction';
import { REDO_NOT_APPLIED } from './redoResult';

const replay_options = { skipUndo: true, skipMacroRecording: true } as const;

function can_revert(entry: UndoEntry): boolean {
    return entry.kind === 'callback' || entry.inverseAction !== null;
}

async function apply_inverse(entry: UndoEntry): Promise<void> {
    if (entry.kind === 'callback') {
        entry.undo();
        return;
    }
    if (entry.inverseAction) {
        await executeAppAction(entry.inverseAction, replay_options);
    }
}

async function roll_back_inverse(entry: UndoEntry): Promise<void> {
    if (entry.kind === 'callback') {
        if ((await entry.redo()) === REDO_NOT_APPLIED) {
            throw new Error(`Callback redo could not roll back undo entry: ${entry.id}`);
        }
        return;
    }
    await executeAppAction(entry.action, replay_options);
}

/**
 * Revert a chronological entry list newest-first. If a later inverse rejects,
 * replay every already-reverted entry in original action order before surfacing
 * the failure. History remains caller-owned and is written only after success.
 */
export async function revertUndoEntriesAtomically(entries: readonly UndoEntry[]): Promise<boolean> {
    if (entries.length === 0 || entries.some((entry) => !can_revert(entry))) {
        return false;
    }

    const reverted_entries: UndoEntry[] = [];
    try {
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index]!;
            await apply_inverse(entry);
            reverted_entries.push(entry);
        }
    } catch (error) {
        const rollback_errors: unknown[] = [];
        for (let index = reverted_entries.length - 1; index >= 0; index -= 1) {
            try {
                await roll_back_inverse(reverted_entries[index]!);
            } catch (rollback_error) {
                rollback_errors.push(rollback_error);
            }
        }
        if (rollback_errors.length > 0) {
            throw new AggregateError([error, ...rollback_errors], 'Undo-group rollback failed', { cause: error });
        }
        throw error;
    }

    return true;
}
