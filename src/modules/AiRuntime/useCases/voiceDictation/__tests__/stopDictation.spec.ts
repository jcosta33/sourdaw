import { describe, it, expect, vi } from 'vitest';

import { stopDictation } from '../stopDictation';

const mocks = vi.hoisted(() => ({
    stopVoiceDictation: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceTauriAdapter/stopDictation', () => ({
    stopDictation: mocks.stopVoiceDictation,
}));

describe('stopDictation (useCase)', () => {
    it('forwards to the voiceTauriAdapter', async () => {
        await stopDictation();
        expect(mocks.stopVoiceDictation).toHaveBeenCalledTimes(1);
    });
});
