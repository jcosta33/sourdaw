import { describe, it, expect, vi } from 'vitest';

import { ensureWhisperReady } from '../ensureWhisperReady';

const mocks = vi.hoisted(() => ({
    ensureWhisperReadyInAdapter: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceNativeAdapter/ensureWhisperReady', () => ({
    ensureWhisperReady: mocks.ensureWhisperReadyInAdapter,
}));

describe('ensureWhisperReady (useCase)', () => {
    it('forwards to the voiceNativeAdapter', async () => {
        await ensureWhisperReady();
        expect(mocks.ensureWhisperReadyInAdapter).toHaveBeenCalledTimes(1);
    });
});
