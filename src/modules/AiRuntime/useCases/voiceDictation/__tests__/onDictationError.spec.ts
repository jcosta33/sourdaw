import { describe, it, expect, vi } from 'vitest';

import { onDictationError } from '../onDictationError';

const mocks = vi.hoisted(() => ({
    onVoiceDictationError: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceNativeAdapter/onDictationError', () => ({
    onDictationError: mocks.onVoiceDictationError,
}));

describe('onDictationError (useCase)', () => {
    it('forwards one session-scoped terminal error to the voiceNativeAdapter', () => {
        mocks.onVoiceDictationError.mockImplementation(
            (_sessionId: string, handler: (payload: { session_id: string; message: string }) => void) => {
                handler({ session_id: 'session-1', message: 'Transcription failed: whisper state error' });
                return vi.fn();
            }
        );

        const callback = vi.fn();
        onDictationError('session-1', callback);

        expect(mocks.onVoiceDictationError).toHaveBeenCalledWith('session-1', expect.any(Function));
        expect(callback).toHaveBeenCalledWith({
            sessionId: 'session-1',
            message: 'Transcription failed: whisper state error',
        });
    });
});
