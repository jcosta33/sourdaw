import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type EditingTool } from '../../models/EditingTool';
import { finishToolSwap } from '../finishToolSwap';

type ToolSwapValue = {
    lastDownTime: number | null;
    lastDownKey: string | null;
    previousTool: EditingTool | null;
};

const mocks = vi.hoisted(
    (): {
        toolSwapValue: { value: ToolSwapValue | null };
        toolSwapSet: ReturnType<typeof vi.fn>;
        setEditingTool: ReturnType<typeof vi.fn>;
    } => ({
        toolSwapValue: {
            value: {
                lastDownTime: null,
                lastDownKey: null,
                previousTool: null,
            },
        },
        toolSwapSet: vi.fn(),
        setEditingTool: vi.fn(),
    })
);

vi.mock('../../stores/toolSwapStore', () => ({
    toolSwapStore: {
        get value() {
            return mocks.toolSwapValue.value;
        },
        set: mocks.toolSwapSet,
    },
}));

vi.mock('../setEditingTool', () => ({
    setEditingTool: mocks.setEditingTool,
}));

const emptyToolSwapState: ToolSwapValue = {
    lastDownTime: null,
    lastDownKey: null,
    previousTool: null,
};

describe('finishToolSwap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.toolSwapValue.value = { ...emptyToolSwapState };
    });

    it('should restore the previous tool and clear the swap when the matching key was held longer than 300ms', () => {
        mocks.toolSwapValue.value = {
            lastDownKey: 'd',
            lastDownTime: 1000,
            previousTool: 'select',
        };

        finishToolSwap({ key: 'd', timestamp: 1301 });

        expect(mocks.setEditingTool).toHaveBeenCalledWith('select');
        expect(mocks.toolSwapSet).toHaveBeenCalledWith(emptyToolSwapState);
    });

    it('should clear the swap without restoring the previous tool for a quick matching tap', () => {
        mocks.toolSwapValue.value = {
            lastDownKey: 'd',
            lastDownTime: 1000,
            previousTool: 'select',
        };

        finishToolSwap({ key: 'd', timestamp: 1299 });

        expect(mocks.setEditingTool).not.toHaveBeenCalled();
        expect(mocks.toolSwapSet).toHaveBeenCalledWith(emptyToolSwapState);
    });

    it('should ignore unrelated key releases without clearing the tracked swap', () => {
        mocks.toolSwapValue.value = {
            lastDownKey: 'd',
            lastDownTime: 1000,
            previousTool: 'select',
        };

        finishToolSwap({ key: 'e', timestamp: 1400 });

        expect(mocks.setEditingTool).not.toHaveBeenCalled();
        expect(mocks.toolSwapSet).not.toHaveBeenCalled();
    });

    it('should clear a matching partial swap state without restoring a tool', () => {
        mocks.toolSwapValue.value = {
            lastDownKey: 'd',
            lastDownTime: null,
            previousTool: 'select',
        };

        finishToolSwap({ key: 'd', timestamp: 1400 });

        expect(mocks.setEditingTool).not.toHaveBeenCalled();
        expect(mocks.toolSwapSet).toHaveBeenCalledWith(emptyToolSwapState);
    });
});
