import { describe, it, expect, vi } from 'vitest';

import { onDictationError } from '../onDictationError';

const mocks = vi.hoisted(() => ({
    onVoiceDictationError: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceTauriAdapter/onDictationError', () => ({
    onDictationError: mocks.onVoiceDictationError,
}));

describe('onDictationError (useCase)', () => {
    it('forwards to the voiceTauriAdapter', async () => {
        mocks.onVoiceDictationError.mockImplementation((handler: (payload: { message: string }) => void) => {
            handler({ message: 'Transcription failed: whisper state error' });
            return Promise.resolve(vi.fn()); // unlisten function
        });

        const callback = vi.fn();
        await onDictationError(callback);

        expect(mocks.onVoiceDictationError).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ message: 'Transcription failed: whisper state error' });
    });
});
