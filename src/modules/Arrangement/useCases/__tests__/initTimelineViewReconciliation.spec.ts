import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initTimelineViewReconciliation } from '../initTimelineViewReconciliation';

const { stopScrollClamp, stopSelection, initTimelineScrollClamp, initClipSelectionReconciliation } = vi.hoisted(() => {
    const stopScroll = vi.fn();
    const stopSel = vi.fn();
    return {
        stopScrollClamp: stopScroll,
        stopSelection: stopSel,
        initTimelineScrollClamp: vi.fn(() => stopScroll),
        initClipSelectionReconciliation: vi.fn(() => stopSel),
    };
});

vi.mock('../initTimelineScrollClamp', () => ({ initTimelineScrollClamp }));
vi.mock('../initClipSelectionReconciliation', () => ({ initClipSelectionReconciliation }));

describe('initTimelineViewReconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('starts the scroll clamp and the clip selection reconciliation once each', () => {
        initTimelineViewReconciliation();

        expect(initTimelineScrollClamp).toHaveBeenCalledOnce();
        expect(initClipSelectionReconciliation).toHaveBeenCalledOnce();
        expect(stopScrollClamp).not.toHaveBeenCalled();
        expect(stopSelection).not.toHaveBeenCalled();
    });

    it('stops both when the returned stop runs', () => {
        const stop = initTimelineViewReconciliation();

        stop();

        expect(stopScrollClamp).toHaveBeenCalledOnce();
        expect(stopSelection).toHaveBeenCalledOnce();
    });
});
