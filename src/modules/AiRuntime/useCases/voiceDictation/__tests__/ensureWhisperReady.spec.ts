import { beforeEach, describe, it, expect, vi } from 'vitest';

import { ensureWhisperReady } from '../ensureWhisperReady';

const mocks = vi.hoisted(() => ({
    ensureWhisperReadyInAdapter: vi.fn(),
    releaseGate: { whisper: true },
}));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: mocks.releaseGate }));

vi.mock('#/modules/AiRuntime/repositories/voiceNativeAdapter/ensureWhisperReady', () => ({
    ensureWhisperReady: mocks.ensureWhisperReadyInAdapter,
}));

describe('ensureWhisperReady (useCase)', () => {
    beforeEach(() => {
        mocks.releaseGate.whisper = true;
        mocks.ensureWhisperReadyInAdapter.mockReset().mockResolvedValue(undefined);
    });

    it('forwards to the voiceNativeAdapter', async () => {
        await ensureWhisperReady();
        expect(mocks.ensureWhisperReadyInAdapter).toHaveBeenCalledTimes(1);
    });

    it('does not touch the native adapter while Whisper artifacts are withheld', async () => {
        mocks.releaseGate.whisper = false;

        await expect(ensureWhisperReady()).rejects.toThrow(/not admitted in this release/);
        expect(mocks.ensureWhisperReadyInAdapter).not.toHaveBeenCalled();
    });
});
