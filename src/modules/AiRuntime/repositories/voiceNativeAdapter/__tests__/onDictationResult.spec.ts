import { describe, it, expect, vi } from 'vitest';

import { desktopListenVoiceDictationTerminal } from '#/utils/desktopBridge';

import { onDictationResult } from '../onDictationResult';

vi.mock('#/utils/desktopBridge', () => ({
    desktopListenVoiceDictationTerminal: vi.fn(),
}));

describe('onDictationResult (voiceNativeAdapter)', () => {
    it('listens for dictation-result and extracts payload', async () => {
        const mockUnlisten = vi.fn();
        vi.mocked(desktopListenVoiceDictationTerminal).mockImplementation((_sessionId, handler) => {
            // Immediately simulate the rust event firing
            handler('dictation-result', {
                payload: { session_id: 'session-1', text: 'hello world', duration_ms: 1500 },
            });
            return mockUnlisten;
        });

        const callback = vi.fn();
        const unlisten = onDictationResult('session-1', callback);

        expect(desktopListenVoiceDictationTerminal).toHaveBeenCalledWith('session-1', expect.any(Function));
        expect(callback).toHaveBeenCalledWith({ session_id: 'session-1', text: 'hello world', duration_ms: 1500 });
        expect(unlisten).toBe(mockUnlisten);
    });

    it('drops malformed and oversized dictation payloads before they reach the callback', async () => {
        vi.mocked(desktopListenVoiceDictationTerminal).mockImplementation((_sessionId, handler) => {
            handler('dictation-result', { payload: { text: 'x'.repeat(32_769), duration_ms: 1500 } });
            handler('dictation-result', { payload: { text: 'hello', duration_ms: -1 } });
            handler('dictation-result', { payload: { text: 'hello', duration_ms: Number.NaN } });
            handler('dictation-result', { payload: { text: 123, duration_ms: 1500 } });
            handler('dictation-result', { payload: { text: 'hello', duration_ms: 3_600_001 } });
            return vi.fn();
        });

        const callback = vi.fn();
        onDictationResult('session-1', callback);

        expect(callback).not.toHaveBeenCalled();
    });
});
