import { createStore } from '#/infra/store/createStore';
import { type EditingTool } from '../models/EditingTool';

export type ToolSwapState = {
    lastDownTime: number | null;
    lastDownKey: string | null;
    previousTool: EditingTool | null;
};

export const toolSwapStore = createStore<ToolSwapState>({
    initialData: {
        lastDownTime: null,
        lastDownKey: null,
        previousTool: null,
    },
});
