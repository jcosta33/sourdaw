import { describe, it, expect, vi } from 'vitest';

import { onDictationResult } from '../onDictationResult';

const mocks = vi.hoisted(() => ({
    onVoiceDictationResult: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/voiceNativeAdapter/onDictationResult', () => ({
    onDictationResult: mocks.onVoiceDictationResult,
}));

describe('onDictationResult (useCase)', () => {
    it('forwards to the voiceNativeAdapter and maps snake_case to camelCase', async () => {
        mocks.onVoiceDictationResult.mockImplementation(
            (handler: (payload: { text: string; duration_ms: number }) => void) => {
                handler({ text: 'test text', duration_ms: 2000 });
                return Promise.resolve(vi.fn()); // unlisten function
            }
        );

        const callback = vi.fn();
        await onDictationResult(callback);

        expect(mocks.onVoiceDictationResult).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ text: 'test text', durationMs: 2000 });
    });
});
