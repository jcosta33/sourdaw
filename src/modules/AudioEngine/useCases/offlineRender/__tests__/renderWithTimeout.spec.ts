import { describe, it, expect } from 'vitest';

import { renderWithTimeout } from '../renderWithTimeout';

function createOfflineContext(result: Promise<AudioBuffer>): OfflineAudioContext {
    return {
        startRendering: () => result,
    } as unknown as OfflineAudioContext;
}

describe('renderWithTimeout', () => {
    it('should resolve with the buffer when rendering completes before timeout', async () => {
        const buffer = { duration: 2, length: 100, sampleRate: 44100 } as AudioBuffer;
        const ctx = createOfflineContext(Promise.resolve(buffer));
        await expect(renderWithTimeout(ctx, 60_000)).resolves.toBe(buffer);
    });

    it('should reject when timeout fires before rendering completes', async () => {
        const ctx = createOfflineContext(new Promise<AudioBuffer>(() => {}));
        await expect(renderWithTimeout(ctx, 25)).rejects.toThrow(/Offline render timed out after 0\.025s/);
    }, 5000);

    it('should propagate rendering errors and clear the timeout', async () => {
        const err = new Error('render failed');
        const ctx = createOfflineContext(Promise.reject(err));
        await expect(renderWithTimeout(ctx, 5000)).rejects.toThrow('render failed');
    });

    it('should wrap non-Error rejections', async () => {
        const ctx = createOfflineContext(Promise.reject('boom'));
        await expect(renderWithTimeout(ctx, 5000)).rejects.toThrow('boom');
    });
});
