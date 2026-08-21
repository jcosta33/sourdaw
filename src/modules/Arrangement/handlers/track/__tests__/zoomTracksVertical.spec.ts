import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleZoomTracksVertical } from '../zoomTracksVertical';

const mocks = vi.hoisted(() => ({
    zoomTracksVertical: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

// Only the writer is stubbed. `clampTrackHeight` lives in its own module and is
// deliberately left real: it is the arithmetic the inverse is guarded on, so a stubbed
// clamp would let the handler and the use case disagree without any test noticing.
vi.mock('../../../useCases/trackZoom', () => ({ zoomTracksVertical: mocks.zoomTracksVertical }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));

function withTracks(heights: (number | undefined)[]) {
    mocks.getTrackStoreState.mockReturnValue({
        tracks: heights.map((height, index) => ({ id: `t${index + 1}`, height })),
    });
}

describe('handleZoomTracksVertical', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        withTracks([64, 100]);
    });

    it('executes zoomTracksVertical with the provided payload', () => {
        void handleZoomTracksVertical.execute({ type: 'zoomTracksVertical', payload: { delta: 1 } });

        expect(mocks.zoomTracksVertical).toHaveBeenCalledWith(1);
    });

    it('provides a description reflecting the zoom direction', () => {
        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: 1 } }).label).toBe(
            'Zoom tracks vertical in'
        );
        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: -1 } }).label).toBe(
            'Zoom tracks vertical out'
        );
    });

    it('describes a height restore carrying the prior heights, not an opposite zoom', () => {
        const description = handleZoomTracksVertical.describe({
            type: 'zoomTracksVertical',
            payload: { delta: 10 },
        });

        expect(description.inverseAction).toEqual({
            type: 'restoreTrackHeights',
            payload: {
                expected: [
                    { trackId: 't1', height: 74 },
                    { trackId: 't2', height: 110 },
                ],
                replacement: [
                    { trackId: 't1', height: 64 },
                    { trackId: 't2', height: 100 },
                ],
            },
        });
        expect(description.redoAction).toEqual({
            type: 'restoreTrackHeights',
            payload: {
                expected: [
                    { trackId: 't1', height: 64 },
                    { trackId: 't2', height: 100 },
                ],
                replacement: [
                    { trackId: 't1', height: 74 },
                    { trackId: 't2', height: 110 },
                ],
            },
        });
    });

    it('carries the height a clamped track keeps, which an opposite delta would not return it to', () => {
        // t1 is pinned at the 300 ceiling: zooming in leaves it there, so undoing with
        // delta -50 would drop it to 250 — a height it never had.
        withTracks([300, 100]);

        const description = handleZoomTracksVertical.describe({
            type: 'zoomTracksVertical',
            payload: { delta: 50 },
        });

        expect(description.inverseAction).toMatchObject({
            payload: {
                expected: [
                    { trackId: 't1', height: 300 },
                    { trackId: 't2', height: 150 },
                ],
                replacement: [
                    { trackId: 't1', height: 300 },
                    { trackId: 't2', height: 100 },
                ],
            },
        });
    });

    it('treats a missing height as the default rather than dropping the track', () => {
        withTracks([undefined]);

        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: 6 } })).toMatchObject({
            inverseAction: {
                payload: { expected: [{ trackId: 't1', height: 70 }], replacement: [{ trackId: 't1', height: 64 }] },
            },
        });
    });

    it('emits no inverse when there are no tracks', () => {
        withTracks([]);

        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: 1 } })).toEqual({
            label: 'Zoom tracks vertical',
            inverseAction: null,
        });
    });

    it('reports a no-op when every track is already pinned at the bound', () => {
        withTracks([300, 300]);

        expect(handleZoomTracksVertical.isNoop?.({ type: 'zoomTracksVertical', payload: { delta: 10 } })).toBe(true);
    });

    it('is not a no-op while any track can still move', () => {
        withTracks([300, 100]);

        expect(handleZoomTracksVertical.isNoop?.({ type: 'zoomTracksVertical', payload: { delta: 10 } })).toBe(false);
    });

    it('is undoable', () => {
        expect(handleZoomTracksVertical.undoable).toBe(true);
    });
});
