import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resumeEngine } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../../ensureTrackStrips';
import { startPlayheadScheduler } from '../../playheadScheduler/startPlayheadScheduler';
import { startPlayback } from '../startPlayback';

const { timeSignatureMapStore } = vi.hoisted(
    (): { timeSignatureMapStore: { value: { changes: unknown[] } | null } } => ({
        timeSignatureMapStore: { value: { changes: [] } },
    })
);
vi.mock('../../../stores/timeSignatureMapStore', () => ({ timeSignatureMapStore }));
vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: vi.fn(),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));
vi.mock('../../ensureTrackStrips', () => ({
    ensureTrackStrips: vi.fn(),
}));

describe('startPlayback', () => {
    beforeEach(() => {
        playheadPositionRef.current = 0;
        timeSignatureMapStore.value = { changes: [] };
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

    it('rolls in over the bars the time-signature map defines, not the flat numerator', () => {
        // 4/4 until beat 6, 3/4 from there. The two bars before beat 12 are both
        // 3/4 (beats 9..12 and 6..9), so a 2-bar pre-roll opens at beat 6.
        // Multiplying the transport numerator gave 12 - 2*4 = 4 — a beat and a
        // half early, and not on a bar line at all.
        timeSignatureMapStore.value = {
            changes: [
                { id: 'ts-a', beat: 0, numerator: 4, denominator: 4 },
                { id: 'ts-b', beat: 6, numerator: 3, denominator: 4 },
            ],
        };
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 12,
            preRollEnabled: true,
            preRollBars: 2,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 6 });
        expect(playheadPositionRef.current).toBe(6);
    });

    it('opens the pre-roll on a real bar line when a meter change lands mid-bar', () => {
        // 3/4 arriving at beat 5, one quarter into the second 4/4 bar. Nothing
        // snaps a change to a bar line, so this is an ordinary project state. Bar
        // lines run 0, 4, 5, 8, 11, and a 3-bar pre-roll from 11 must open at 4.
        // Subtracting bar lengths walked 8, 5, then 1 — three quarter notes early
        // and not a bar line at all, so the count came in off the bar.
        timeSignatureMapStore.value = {
            changes: [{ id: 'ts-a', beat: 5, numerator: 3, denominator: 4 }],
        };
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 11,
            preRollEnabled: true,
            preRollBars: 3,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 4 });
        expect(playheadPositionRef.current).toBe(4);
    });

    it('sizes a pre-roll bar by the meter denominator, not by the numerator alone', () => {
        // 6/8 bars are three quarter notes long, so two of them reach back six
        // beats from 12. Treating the numerator as quarter notes reached back
        // twelve and started the pre-roll at the timeline origin.
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 12,
            preRollEnabled: true,
            preRollBars: 2,
            timeSignatureNumerator: 6,
            timeSignatureDenominator: 8,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 6 });
    });

    it('clamps a pre-roll that reaches back past the timeline origin', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 2,
            preRollEnabled: true,
            preRollBars: 2,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 0 });
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
