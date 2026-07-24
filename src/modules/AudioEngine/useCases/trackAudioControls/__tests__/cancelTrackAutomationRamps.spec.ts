import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { cancelTrackAutomationRamps } from '../cancelTrackAutomationRamps';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { cancelTrackAutomationRamps: vi.fn() },
}));

describe('cancelTrackAutomationRamps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to the engine so pending gain/pan ramps are cancelled on stop', () => {
        cancelTrackAutomationRamps();

        expect(audioEngine.cancelTrackAutomationRamps).toHaveBeenCalledTimes(1);
    });
});
