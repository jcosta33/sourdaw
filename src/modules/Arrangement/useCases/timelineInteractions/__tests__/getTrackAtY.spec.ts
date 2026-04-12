import { describe, it, expect } from 'vitest';

import { getTrackAtY } from '../getTrackAtY';

describe('getTrackAtY', () => {
    it('should return the track index and id when Y falls inside a row', () => {
        const tracks = [
            { id: 'a', height: 40 },
            { id: 'b', height: 60 },
        ];
        expect(getTrackAtY(tracks, 10)).toEqual({ index: 0, id: 'a' });
        expect(getTrackAtY(tracks, 45)).toEqual({ index: 1, id: 'b' });
    });

    it('should return null when Y is below or past all tracks', () => {
        const tracks = [{ id: 'a', height: 10 }];
        expect(getTrackAtY(tracks, -1)).toBeNull();
        expect(getTrackAtY(tracks, 10)).toBeNull();
    });
});
