import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCachedWhisperModel } from '../loadCachedWhisperModel';

const mocks = vi.hoisted(() => ({
    loadCachedWhisperModel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    admission: { whisper: true },
}));

vi.mock('../../../repositories/voiceNativeAdapter/loadCachedWhisperModel', () => ({
    loadCachedWhisperModel: mocks.loadCachedWhisperModel,
}));
vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: mocks.admission }));

describe('loadCachedWhisperModel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.admission.whisper = true;
    });

    it('delegates only to the cache-only native adapter', async () => {
        await loadCachedWhisperModel();

        expect(mocks.loadCachedWhisperModel).toHaveBeenCalledOnce();
    });

    it('refuses a cached artifact withheld by release admission', async () => {
        mocks.admission.whisper = false;

        await expect(loadCachedWhisperModel()).rejects.toThrow('withheld');
        expect(mocks.loadCachedWhisperModel).not.toHaveBeenCalled();
    });
});
