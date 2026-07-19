import { redoUnderMutation } from './redoUnderMutation';
import { runUndoRedoExclusive } from './undoRedo';

export function redo(): Promise<void> {
    return runUndoRedoExclusive(redoUnderMutation);
}
