import { describe, it, expect, vi } from 'vitest';

import { desktopListen } from '#/utils/desktopBridge';

import { onDictationError } from '../onDictationError';

vi.mock('#/utils/desktopBridge', () => ({
    desktopListen: vi.fn(),
}));

describe('onDictationError (voiceNativeAdapter)', () => {
    it('listens for dictation-error and extracts the message', async () => {
        const mockUnlisten = vi.fn();
        vi.mocked(desktopListen).mockImplementation((_event, handler) => {
            handler({ payload: { message: 'Recording failed: no microphone found' } });
            return Promise.resolve(mockUnlisten);
        });

        const callback = vi.fn();
        const unlisten = await onDictationError(callback);

        expect(desktopListen).toHaveBeenCalledWith('dictation-error', expect.any(Function));
        expect(callback).toHaveBeenCalledWith({ message: 'Recording failed: no microphone found' });
        expect(unlisten).toBe(mockUnlisten);
    });

    it('drops malformed and oversized dictation-error payloads before they reach the callback', async () => {
        vi.mocked(desktopListen).mockImplementation((_event, handler) => {
            handler({ payload: { message: '' } });
            handler({ payload: { message: 'x'.repeat(2_049) } });
            handler({ payload: { message: 123 } });
            handler({ payload: {} });
            handler({ notPayload: true });
            handler(null);
            return Promise.resolve(vi.fn());
        });

        const callback = vi.fn();
        await onDictationError(callback);

        expect(callback).not.toHaveBeenCalled();
    });
});
