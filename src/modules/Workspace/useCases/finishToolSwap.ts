import { toolSwapStore } from '../stores/toolSwapStore';

import { setEditingTool } from './setEditingTool';

const TOOL_SWAP_HOLD_THRESHOLD_MS = 300;

type FinishToolSwapInput = {
    key: string;
    timestamp: number;
};

const emptyToolSwapState = {
    lastDownTime: null,
    lastDownKey: null,
    previousTool: null,
};

export function finishToolSwap(input: FinishToolSwapInput): void {
    const swap = toolSwapStore.value;
    if (!swap) {
        return;
    }
    if (swap.lastDownKey !== input.key) {
        return;
    }

    if (swap.lastDownTime !== null && swap.previousTool !== null) {
        const duration = input.timestamp - swap.lastDownTime;
        if (duration > TOOL_SWAP_HOLD_THRESHOLD_MS) {
            setEditingTool(swap.previousTool);
        }
    }

    toolSwapStore.set(emptyToolSwapState);
}
