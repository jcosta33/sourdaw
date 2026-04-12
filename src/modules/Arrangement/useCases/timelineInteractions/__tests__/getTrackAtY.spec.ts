import { describe, expect, it } from 'vitest';

import { getTrackAtY } from '../getTrackAtY';

describe('getTrackAtY', () => {
    it('returns null when there are no tracks', () => {
        expect(getTrackAtY([], 0)).toBeNull();
    });

    it('returns the track index whose vertical span contains contentY', () => {
        const tracks = [
            { id: 'a', height: 40 },
            { id: 'b', height: 40 },
        ];
        expect(getTrackAtY(tracks, 10)).toEqual({ index: 0, id: 'a' });
        expect(getTrackAtY(tracks, 45)).toEqual({ index: 1, id: 'b' });
    });

    it('returns null when contentY falls past the last track', () => {
        const tracks = [
            { id: 'a', height: 32 },
            { id: 'b', height: 32 },
        ];
        expect(getTrackAtY(tracks, 70)).toBeNull();
    });

    it('places the boundary on the next row at the cumulative height', () => {
        const tracks = [
            { id: 'a', height: 40 },
            { id: 'b', height: 40 },
        ];
        expect(getTrackAtY(tracks, 39)).toEqual({ index: 0, id: 'a' });
        expect(getTrackAtY(tracks, 40)).toEqual({ index: 1, id: 'b' });
    });

    it('handles a single tall track', () => {
        expect(getTrackAtY([{ id: 'only', height: 200 }], 100)).toEqual({ index: 0, id: 'only' });
    });

    it('treats negative contentY as a miss', () => {
        expect(getTrackAtY([{ id: 'a', height: 64 }], -1)).toBeNull();
    });

    it('uses 64px when height is undefined', () => {
        const tracks = [{ id: 'flex', height: undefined as unknown as number }];
        expect(getTrackAtY(tracks, 10)).toEqual({ index: 0, id: 'flex' });
        expect(getTrackAtY(tracks, 63)).toEqual({ index: 0, id: 'flex' });
        expect(getTrackAtY(tracks, 64)).toBeNull();
    });

    it('returns null when y equals the total stacked height (exclusive end)', () => {
        const tracks = [
            { id: 'a', height: 32 },
            { id: 'b', height: 32 },
        ];
        expect(getTrackAtY(tracks, 64)).toBeNull();
    });
});
