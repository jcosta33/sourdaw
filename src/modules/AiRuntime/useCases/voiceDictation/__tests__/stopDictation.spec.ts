import { describe, it, expect, vi } from 'vitest';

import { stopDictation } from '../stopDictation';

const mocks = vi.hoisted(() => ({
    stopVoiceDictation: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceNativeAdapter/stopDictation', () => ({
    stopDictation: mocks.stopVoiceDictation,
}));

describe('stopDictation (useCase)', () => {
    it('forwards to the voiceNativeAdapter', async () => {
        await stopDictation();
        expect(mocks.stopVoiceDictation).toHaveBeenCalledTimes(1);
    });
});
