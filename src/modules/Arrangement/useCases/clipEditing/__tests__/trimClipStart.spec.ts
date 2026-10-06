import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trimClipStart } from '../trimClipStart';

import type { Clip } from '#/modules/Arrangement/models/Track';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn<typeof import('#/modules/Arrangement/repositories/track/updateClip').updateClip>(),
    getTrackState: vi.fn<typeof import('#/modules/Arrangement/repositories/track/getTrackState').getTrackState>(),
    writeTakeStarts: vi.fn<typeof import('../../comping/writeTakeStarts').writeTakeStarts>(),
    planTrimmedTakeStarts: vi.fn<typeof import('../../comping/planTrimmedTakeStarts').planTrimmedTakeStarts>(),
}));

vi.mock('../../comping/planTrimmedTakeStarts', () => ({
    planTrimmedTakeStarts: mocks.planTrimmedTakeStarts,
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../comping/writeTakeStarts', () => ({
    writeTakeStarts: mocks.writeTakeStarts,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('trimClipStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue(null);
        mocks.updateClip.mockReturnValue(true);
    });

    it('updates startBeat and audioOffsetBeats correctly', () => {
        trimClipStart('c1', 2);

        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        const updater = mocks.updateClip.mock.calls[0]![1];

        const mockClip = { startBeat: 0, endBeat: 10, audioOffsetBeats: 0 } as unknown as Clip;
        const result = updater(mockClip);

        expect(result.startBeat).toBe(2);
        expect(result.audioOffsetBeats).toBe(2);
    });

    it('claps startBeat to zero', () => {
        trimClipStart('c1', -5);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const result = updater({ startBeat: 2, endBeat: 10, audioOffsetBeats: 0 } as unknown as Clip);

        expect(result.startBeat).toBe(0);
        expect(result.audioOffsetBeats).toBe(-2);
    });

    it('ignores trim if new start is after endBeat', () => {
        trimClipStart('c1', 15);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const mockClip = { startBeat: 0, endBeat: 10 } as unknown as Clip;
        const result = updater(mockClip);

        expect(result).toBe(mockClip);
    });

    it('defaults a missing audioOffsetBeats to zero when applying the trim delta', () => {
        trimClipStart('c1', 3);
        const updater = mocks.updateClip.mock.calls[0]![1];
        // Clip carries no audioOffsetBeats — the updater must treat it as 0.
        const mockClip = { startBeat: 0, endBeat: 10 } as unknown as Clip;
        const result = updater(mockClip);

        expect(result.startBeat).toBe(3);
        expect(result.audioOffsetBeats).toBe(3);
    });

    it('starts the loop passes of the clip at the new start once the trim lands', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 12 }] }],
        } as unknown as ReturnType<typeof mocks.getTrackState>);
        mocks.planTrimmedTakeStarts.mockReturnValue({
            before: [{ takeId: 'pass-1', startBeat: 0, sourceOffsetBeats: 0 }],
            after: [{ takeId: 'pass-1', startBeat: 1, sourceOffsetBeats: 1 }],
        });

        expect(trimClipStart('c1', 1)).toBe(true);

        expect(mocks.planTrimmedTakeStarts).toHaveBeenCalledWith({
            clipId: 'c1',
            previousStartBeat: 0,
            newStartBeat: 1,
        });
        expect(mocks.writeTakeStarts).toHaveBeenCalledWith([{ takeId: 'pass-1', startBeat: 1, sourceOffsetBeats: 1 }]);
    });

    it('moves no take when the trim does not apply', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 12 }] }],
        } as unknown as ReturnType<typeof mocks.getTrackState>);

        expect(trimClipStart('c1', 15)).toBe(false);

        expect(mocks.writeTakeStarts).not.toHaveBeenCalled();
    });
});
