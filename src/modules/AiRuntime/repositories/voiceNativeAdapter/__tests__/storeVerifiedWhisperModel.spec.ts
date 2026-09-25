import { describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { storeVerifiedWhisperModel } from '../storeVerifiedWhisperModel';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('storeVerifiedWhisperModel', () => {
    it('hands the bytes to the native verified writer command', async () => {
        const bytes = new Uint8Array([1, 2, 3]);

        await storeVerifiedWhisperModel(bytes);

        expect(desktopInvoke).toHaveBeenCalledWith('store_verified_whisper_model', { bytes });
    });
});
