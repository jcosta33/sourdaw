import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleZoomTracksVertical } from '../zoomTracksVertical';

const mocks = vi.hoisted(() => ({
    zoomTracksVertical: vi.fn(),
}));

vi.mock('../../../useCases/trackZoom', () => ({
    zoomTracksVertical: mocks.zoomTracksVertical,
}));

describe('handleZoomTracksVertical', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes zoomTracksVertical with the provided payload', () => {
        void handleZoomTracksVertical.execute({
            type: 'zoomTracksVertical',
            payload: { delta: 1 },
        });

        expect(mocks.zoomTracksVertical).toHaveBeenCalledWith(1);
    });

    it('provides a description reflecting the zoom direction', () => {
        const desc1 = handleZoomTracksVertical.describe({
            type: 'zoomTracksVertical',
            payload: { delta: 1 },
        });
        expect(desc1.label).toBe('Zoom tracks vertical in');

        const desc2 = handleZoomTracksVertical.describe({
            type: 'zoomTracksVertical',
            payload: { delta: -1 },
        });
        expect(desc2.label).toBe('Zoom tracks vertical out');
    });

    it('is undoable', () => {
        expect(handleZoomTracksVertical.undoable).toBe(true);
    });
});
