import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startAudioRecording as startAudioRecordingRepo } from '../../../repositories/audioRecorder/recording';
import { getSelectedInputId } from '../../audioDeviceSelection/getSelectedInputId';
import { startAudioRecording } from '../startAudioRecording';

const mocks = vi.hoisted(() => ({
    startInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
    tracks: [] as Array<{ id: string; inputMonitoring: string }>,
}));

vi.mock('../../../repositories/audioRecorder/recording', () => ({
    startAudioRecording: vi.fn(),
}));

vi.mock('../../audioDeviceSelection/getSelectedInputId', () => ({
    getSelectedInputId: vi.fn(),
}));

vi.mock('../startInputMonitoring', () => ({
    startInputMonitoring: mocks.startInputMonitoring,
}));

vi.mock('../stopTrackInputMonitoring', () => ({
    stopTrackInputMonitoring: mocks.stopTrackInputMonitoring,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: mocks.tracks } },
}));

describe('startAudioRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tracks.length = 0;
        vi.mocked(startAudioRecordingRepo).mockResolvedValue(true);
        vi.mocked(getSelectedInputId).mockReturnValue('selected-input');
    });

    it('should preserve an explicit input id', async () => {
        const on_terminal = vi.fn();

        await startAudioRecording('track-1', on_terminal, 'explicit-input');

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_terminal, 'explicit-input');
    });

    it('should preserve null as the default-device input id', async () => {
        const on_terminal = vi.fn();

        await startAudioRecording('track-1', on_terminal, null);

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_terminal, null);
    });

    it('should resolve omitted input ids from the selected input use case', async () => {
        const on_terminal = vi.fn();

        await startAudioRecording('track-1', on_terminal);

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_terminal, 'selected-input');
    });

    it('should resolve undefined input ids from the selected input use case', async () => {
        const on_terminal = vi.fn();

        await startAudioRecording('track-1', on_terminal, undefined);

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_terminal, 'selected-input');
    });

    describe('mode-respecting listening path', () => {
        it('opens the one intentional listening path for an On track', async () => {
            mocks.tracks.push({ id: 'track-1', inputMonitoring: 'on' });

            await expect(startAudioRecording('track-1', vi.fn())).resolves.toBe(true);

            expect(mocks.startInputMonitoring).toHaveBeenCalledWith('track-1', 'selected-input');
            expect(mocks.stopTrackInputMonitoring).not.toHaveBeenCalled();
        });

        it('opens the record-driven listening path for an Auto track', async () => {
            mocks.tracks.push({ id: 'track-1', inputMonitoring: 'auto' });

            await expect(startAudioRecording('track-1', vi.fn())).resolves.toBe(true);

            expect(mocks.startInputMonitoring).toHaveBeenCalledWith('track-1', 'selected-input');
            expect(mocks.stopTrackInputMonitoring).not.toHaveBeenCalled();
        });

        it('keeps an Off capture silent by removing any stray listening edge', async () => {
            mocks.tracks.push({ id: 'track-1', inputMonitoring: 'off' });

            await expect(startAudioRecording('track-1', vi.fn())).resolves.toBe(true);

            expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
            expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        });

        it('defaults a missing track to no listening edge', async () => {
            await expect(startAudioRecording('track-1', vi.fn())).resolves.toBe(true);

            expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
            expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        });

        it('engages no listening path when admission fails', async () => {
            mocks.tracks.push({ id: 'track-1', inputMonitoring: 'on' });
            vi.mocked(startAudioRecordingRepo).mockResolvedValueOnce(false);

            await expect(startAudioRecording('track-1', vi.fn())).resolves.toBe(false);

            expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
            expect(mocks.stopTrackInputMonitoring).not.toHaveBeenCalled();
        });

        it('reads the mode after admission so a flip made while the grant was pending wins', async () => {
            mocks.tracks.push({ id: 'track-1', inputMonitoring: 'on' });
            let admitRecording!: (admitted: boolean) => void;
            vi.mocked(startAudioRecordingRepo).mockReturnValueOnce(
                new Promise<boolean>((resolve) => {
                    admitRecording = resolve;
                })
            );

            const starting = startAudioRecording('track-1', vi.fn());
            await Promise.resolve();
            mocks.tracks.length = 0;
            mocks.tracks.push({ id: 'track-1', inputMonitoring: 'off' });
            admitRecording(true);
            await starting;

            expect(mocks.stopTrackInputMonitoring).toHaveBeenCalledWith('track-1');
            expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
        });
    });
});
