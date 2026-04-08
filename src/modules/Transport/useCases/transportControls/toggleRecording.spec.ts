import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleRecording } from './toggleRecording';

describe('toggleRecording', () => {
    it('should not change transport when state is missing', () => {
        const update = vi.fn();
        injectDependencies(toggleRecording, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
            getTrackStoreState: vi.fn(),
            updateClip: vi.fn(),
            resumeEngine: vi.fn(),
            getAudioContext: vi.fn(),
            scheduleClick: vi.fn(),
            startAudioRecording: vi.fn(),
            stopAudioRecording: vi.fn(),
            startRecording: vi.fn(),
            stopRecording: vi.fn(),
            audioBufferCache: { set: vi.fn() },
            ensureTrackStrips: vi.fn(),
            startPlayback: vi.fn(),
        });

        toggleRecording();

        expect(update).not.toHaveBeenCalled();
    });
});
