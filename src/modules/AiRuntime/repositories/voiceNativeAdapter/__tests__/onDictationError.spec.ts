import { describe, it, expect, vi } from 'vitest';

import { desktopListenVoiceDictationTerminal } from '#/utils/desktopBridge';

import { onDictationError } from '../onDictationError';

vi.mock('#/utils/desktopBridge', () => ({
    desktopListenVoiceDictationTerminal: vi.fn(),
}));

describe('onDictationError (voiceNativeAdapter)', () => {
    it('listens for dictation-error and extracts the message', async () => {
        const mockUnlisten = vi.fn();
        vi.mocked(desktopListenVoiceDictationTerminal).mockImplementation((_sessionId, handler) => {
            handler('dictation-error', {
                payload: { session_id: 'session-1', message: 'Recording failed: no microphone found' },
            });
            return mockUnlisten;
        });

        const callback = vi.fn();
        const unlisten = onDictationError('session-1', callback);

        expect(desktopListenVoiceDictationTerminal).toHaveBeenCalledWith('session-1', expect.any(Function));
        expect(callback).toHaveBeenCalledWith({
            session_id: 'session-1',
            message: 'Recording failed: no microphone found',
        });
        expect(unlisten).toBe(mockUnlisten);
    });

    it('drops malformed and oversized dictation-error payloads before they reach the callback', async () => {
        vi.mocked(desktopListenVoiceDictationTerminal).mockImplementation((_sessionId, handler) => {
            handler('dictation-error', { payload: { message: '' } });
            handler('dictation-error', { payload: { message: 'x'.repeat(2_049) } });
            handler('dictation-error', { payload: { message: 123 } });
            handler('dictation-error', { payload: {} });
            handler('dictation-error', { notPayload: true });
            handler('dictation-error', null);
            return vi.fn();
        });

        const callback = vi.fn();
        onDictationError('session-1', callback);

        expect(callback).not.toHaveBeenCalled();
    });
});
