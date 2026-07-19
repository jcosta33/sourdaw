import { undoStore } from '../stores/undoStore';

import { redoUnderMutation } from './redoUnderMutation';
import { runUndoRedoExclusive } from './undoRedo';
import { undoUnderMutation } from './undoUnderMutation';

export function undoToIndex(targetIndex: number): Promise<void> {
    return runUndoRedoExclusive(async () => {
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
                await undoUnderMutation();
            }
            return;
        }

        const stepsForward = targetIndex - currentIndex;
        for (let index = 0; index < stepsForward; index++) {
            await redoUnderMutation();
        }
    });
}
