import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resumeEngine } from '#/modules/AudioEngine/useCases/engineAccess/resumeEngine';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../../ensureTrackStrips';
import { startPlayheadScheduler } from '../../startPlayheadScheduler';
import { startPlayback } from '../startPlayback';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/engineAccess/resumeEngine', () => ({
    resumeEngine: vi.fn(),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));
vi.mock('../../startPlayheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));
vi.mock('../../ensureTrackStrips', () => ({
    ensureTrackStrips: vi.fn(),
}));

describe('startPlayback', () => {
    beforeEach(() => {
        playheadPositionRef.current = 0;
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
        vi.mocked(resumeEngine).mockReset();
        // resumeEngine returns Promise<void>; default to a resolved promise so
        // the `.catch` chain in startPlayback has a thenable to attach to.
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(notifyUser).mockClear();
        vi.mocked(startPlayheadScheduler).mockClear();
        vi.mocked(ensureTrackStrips).mockClear();
    });

    it('should resume engine and mark playing when state exists', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 8,
            preRollEnabled: false,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(resumeEngine).toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 8 });
        expect(playheadPositionRef.current).toBe(8);
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });

    it('surfaces a failed engine resume to the user while still starting playback', async () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 0,
            preRollEnabled: false,
        });
        vi.mocked(resumeEngine).mockRejectedValue(new Error('resume blocked'));

        startPlayback();

        // The transport still advances (resume is best-effort), but the rejection
        // is no longer swallowed — the user is warned to re-arm audio.
        expect(startPlayheadScheduler).toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('suspended'), 'warning');
        });
    });

    it('should not start when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(resumeEngine).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('should be a no-op when already playing so a duplicate trigger does not re-snap the scheduler', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            playheadPosition: 8,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        // Re-running while playing would re-call startPlayheadScheduler, which
        // re-snaps lastTickTime and costs one tick of playhead advance.
        expect(resumeEngine).not.toHaveBeenCalled();
        expect(ensureTrackStrips).not.toHaveBeenCalled();
        expect(startPlayheadScheduler).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });
});
