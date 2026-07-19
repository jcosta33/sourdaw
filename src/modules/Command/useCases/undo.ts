import { runUndoRedoExclusive } from './undoRedo';
import { undoUnderMutation } from './undoUnderMutation';

export function undo(): Promise<void> {
    return runUndoRedoExclusive(undoUnderMutation);
}
