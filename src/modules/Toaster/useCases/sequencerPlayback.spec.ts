import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { startSequencer, stopSequencer } from './sequencerPlayback';

describe('startSequencer', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('reads the audio clock when starting', () => {
        const getAudioTime = vi.fn(() => 0);
        injectDependencies(startSequencer, {
            getAudioTime,
            getFirstToasterDeviceId: () => null,
            setToasterPadParam: vi.fn(),
            setPadEngineImmediate: vi.fn(),
            triggerToasterPad: vi.fn(),
        });

        startSequencer(120, 4);
        stopSequencer();

        expect(getAudioTime).toHaveBeenCalled();
    });
});
