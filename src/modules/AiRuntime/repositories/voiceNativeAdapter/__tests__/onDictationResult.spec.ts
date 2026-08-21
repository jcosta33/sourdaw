import { describe, it, expect, vi } from 'vitest';

import { desktopListen } from '#/utils/desktopBridge';

import { onDictationResult } from '../onDictationResult';

vi.mock('#/utils/desktopBridge', () => ({
    desktopListen: vi.fn(),
}));

describe('onDictationResult (voiceNativeAdapter)', () => {
    it('listens for dictation-result and extracts payload', async () => {
        const mockUnlisten = vi.fn();
        vi.mocked(desktopListen).mockImplementation((_event, handler) => {
            // Immediately simulate the rust event firing
            handler({ payload: { session_id: 'session-1', text: 'hello world', duration_ms: 1500 } });
            return Promise.resolve(mockUnlisten);
        });

        const callback = vi.fn();
        const unlisten = await onDictationResult(callback);

        expect(desktopListen).toHaveBeenCalledWith('dictation-result', expect.any(Function));
        expect(callback).toHaveBeenCalledWith({ session_id: 'session-1', text: 'hello world', duration_ms: 1500 });
        expect(unlisten).toBe(mockUnlisten);
    });

    it('drops malformed and oversized dictation payloads before they reach the callback', async () => {
        vi.mocked(desktopListen).mockImplementation((_event, handler) => {
            handler({ payload: { text: 'x'.repeat(32_769), duration_ms: 1500 } });
            handler({ payload: { text: 'hello', duration_ms: -1 } });
            handler({ payload: { text: 'hello', duration_ms: Number.NaN } });
            handler({ payload: { text: 123, duration_ms: 1500 } });
            handler({ payload: { text: 'hello', duration_ms: 3_600_001 } });
            return Promise.resolve(vi.fn());
        });

        const callback = vi.fn();
        await onDictationResult(callback);

        expect(callback).not.toHaveBeenCalled();
    });
});
