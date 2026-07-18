import { type EditingTool } from '../models/EditingTool';
import { getWorkspaceState } from '../repositories/getWorkspaceState';
import { toolSwapStore } from '../stores/toolSwapStore';

type StartToolSwapInput = {
    key: string;
    timestamp: number;
    tool: EditingTool;
};

export function startToolSwap(input: StartToolSwapInput): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    if (current.activeTool === input.tool) {
        return;
    }

    toolSwapStore.set({
        lastDownKey: input.key,
        lastDownTime: input.timestamp,
        previousTool: current.activeTool,
    });
}
