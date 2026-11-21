import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initTimelineViewReconciliation } from '../initTimelineViewReconciliation';

const {
    stopScrollClamp,
    stopSelection,
    stopTrackSelection,
    initTimelineScrollClamp,
    initClipSelectionReconciliation,
    initTrackSelectionVisibility,
} = vi.hoisted(() => {
    const stopScroll = vi.fn();
    const stopSel = vi.fn();
    const stopTrack = vi.fn();
    return {
        stopScrollClamp: stopScroll,
        stopSelection: stopSel,
        stopTrackSelection: stopTrack,
        initTimelineScrollClamp: vi.fn(() => stopScroll),
        initClipSelectionReconciliation: vi.fn(() => stopSel),
        initTrackSelectionVisibility: vi.fn(() => stopTrack),
    };
});

vi.mock('../initTimelineScrollClamp', () => ({ initTimelineScrollClamp }));
vi.mock('../initClipSelectionReconciliation', () => ({ initClipSelectionReconciliation }));
vi.mock('../initTrackSelectionVisibility', () => ({ initTrackSelectionVisibility }));

describe('initTimelineViewReconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('starts the scroll clamp and both selection reconciliations once each', () => {
        initTimelineViewReconciliation();

        expect(initTimelineScrollClamp).toHaveBeenCalledOnce();
        expect(initClipSelectionReconciliation).toHaveBeenCalledOnce();
        expect(initTrackSelectionVisibility).toHaveBeenCalledOnce();
        expect(stopScrollClamp).not.toHaveBeenCalled();
        expect(stopSelection).not.toHaveBeenCalled();
    });

    it('stops all when the returned stop runs', () => {
        const stop = initTimelineViewReconciliation();

        stop();

        expect(stopScrollClamp).toHaveBeenCalledOnce();
        expect(stopSelection).toHaveBeenCalledOnce();
        expect(stopTrackSelection).toHaveBeenCalledOnce();
    });
});
