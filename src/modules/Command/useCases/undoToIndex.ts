import { undoStore } from '../stores/undoStore';

import { redo } from './redo';
import { undo } from './undo';

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
        return;
    }

    const stepsForward = targetIndex - currentIndex;
    for (let index = 0; index < stepsForward; index++) {
        await redo();
    }
}
