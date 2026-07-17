import { describe, it, expect, vi } from 'vitest';

import { tauriListen } from '#/utils/tauriBridge';

import { onDictationResult } from '../onDictationResult';

vi.mock('#/utils/tauriBridge', () => ({
    tauriListen: vi.fn(),
}));

describe('onDictationResult (voiceTauriAdapter)', () => {
    it('listens for dictation-result and extracts payload', async () => {
        const mockUnlisten = vi.fn();
        vi.mocked(tauriListen).mockImplementation((_event, handler) => {
            // Immediately simulate the rust event firing
            handler({ payload: { text: 'hello world', duration_ms: 1500 } });
            return Promise.resolve(mockUnlisten);
        });

        const callback = vi.fn();
        const unlisten = await onDictationResult(callback);

        expect(tauriListen).toHaveBeenCalledWith('dictation-result', expect.any(Function));
        expect(callback).toHaveBeenCalledWith({ text: 'hello world', duration_ms: 1500 });
        expect(unlisten).toBe(mockUnlisten);
    });
});
