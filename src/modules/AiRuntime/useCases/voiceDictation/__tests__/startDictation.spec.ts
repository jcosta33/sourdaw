import { describe, it, expect, vi } from 'vitest';

import { startDictation } from '../startDictation';

const mocks = vi.hoisted(() => ({
    startVoiceDictation: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceNativeAdapter/startDictation', () => ({
    startDictation: mocks.startVoiceDictation,
}));

describe('startDictation (useCase)', () => {
    it('forwards to the voiceNativeAdapter', async () => {
        await startDictation();
        expect(mocks.startVoiceDictation).toHaveBeenCalledTimes(1);
    });
});
