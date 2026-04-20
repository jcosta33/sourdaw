import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackHeight } from '../setTrackHeight';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('setTrackHeight', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should clamp height into 30–300 and pass it through updateTrack', () => {
        setTrackHeight('t1', 200);

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { height: number; id: string }) => {
            height: number;
            id: string;
        };
        expect(patch({ height: 64, id: 't1' })).toEqual({ height: 200, id: 't1' });
    });

    it('should clamp heights below 30 up to 30', () => {
        setTrackHeight('t1', 10);

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { height: number; id: string }) => {
            height: number;
            id: string;
        };
        expect(patch({ height: 64, id: 't1' })).toEqual({ height: 30, id: 't1' });
    });

    it('should clamp heights above 300 down to 300', () => {
        setTrackHeight('t1', 500);

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { height: number; id: string }) => {
            height: number;
            id: string;
        };
        expect(patch({ height: 64, id: 't1' })).toEqual({ height: 300, id: 't1' });
    });
});
