import { describe, it, expect, vi } from 'vitest';

import { onDictationResult } from '../onDictationResult';

const mocks = vi.hoisted(() => ({
    onVoiceDictationResult: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceNativeAdapter/onDictationResult', () => ({
    onDictationResult: mocks.onVoiceDictationResult,
}));

describe('onDictationResult (useCase)', () => {
    it('forwards one session-scoped terminal result to the voiceNativeAdapter', () => {
        mocks.onVoiceDictationResult.mockImplementation(
            (
                _sessionId: string,
                handler: (payload: { session_id: string; text: string; duration_ms: number }) => void
            ) => {
                handler({ session_id: 'session-1', text: 'test text', duration_ms: 2000 });
                return vi.fn();
            }
        );

        const callback = vi.fn();
        onDictationResult('session-1', callback);

        expect(mocks.onVoiceDictationResult).toHaveBeenCalledWith('session-1', expect.any(Function));
        expect(callback).toHaveBeenCalledWith({ sessionId: 'session-1', text: 'test text', durationMs: 2000 });
    });
});
