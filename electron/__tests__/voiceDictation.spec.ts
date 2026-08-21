import { describe, expect, it, vi } from 'vitest';

import {
    VOICE_DICTATION_ARM_CHANNEL,
    VOICE_DICTATION_CANCEL_CHANNEL,
    VOICE_DICTATION_START_CHANNEL,
    VOICE_DICTATION_STOP_CHANNEL,
} from '../channels.js';
import { registerVoiceDictation } from '../voiceDictation.js';

const trustedEvent = { senderFrame: { url: 'app://sourdaw/index.html' } };

describe('registerVoiceDictation', () => {
    it('requires an Electron-held, one-use activation before native capture can start', async () => {
        const handlers = new Map<string, (event: typeof trustedEvent, ...args: readonly unknown[]) => unknown>();
        const native = {
            startDictation: vi.fn(async (sessionId: string) => sessionId),
            stopDictation: vi.fn(),
            cancelDictation: vi.fn().mockResolvedValue(undefined),
        };
        registerVoiceDictation({
            ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
            native: () => native,
            isTrustedFrameUrl: (url) => url === trustedEvent.senderFrame.url,
        });

        const start = handlers.get(VOICE_DICTATION_START_CHANNEL)!;
        const arm = handlers.get(VOICE_DICTATION_ARM_CHANNEL)!;
        await expect(start(trustedEvent, 'session-1', 'forged-token-value')).rejects.toThrow(/activation/u);
        expect(native.startDictation).not.toHaveBeenCalled();

        await arm(trustedEvent, 'fresh-activation-token');
        await expect(start(trustedEvent, 'session-1', 'fresh-activation-token')).resolves.toBe('session-1');
        expect(native.startDictation).toHaveBeenCalledWith('session-1');

        await expect(start(trustedEvent, 'session-2', 'fresh-activation-token')).rejects.toThrow(/activation/u);
        expect(native.startDictation).toHaveBeenCalledTimes(1);
    });

    it('keeps stop and cancellation on the correlated dedicated path', async () => {
        const handlers = new Map<string, (event: typeof trustedEvent, ...args: readonly unknown[]) => unknown>();
        const native = {
            startDictation: vi.fn(async (sessionId: string) => sessionId),
            stopDictation: vi.fn(),
            cancelDictation: vi.fn().mockResolvedValue(undefined),
        };
        registerVoiceDictation({
            ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
            native: () => native,
            isTrustedFrameUrl: () => true,
        });

        await handlers.get(VOICE_DICTATION_STOP_CHANNEL)!(trustedEvent, 'session-1');
        await handlers.get(VOICE_DICTATION_CANCEL_CHANNEL)!(trustedEvent, 'session-1');

        expect(native.stopDictation).toHaveBeenCalledWith('session-1');
        expect(native.cancelDictation).toHaveBeenCalledWith('session-1');
    });

    it('keeps Electron responsive while native cancellation awaits worker cleanup', async () => {
        const handlers = new Map<string, (event: typeof trustedEvent, ...args: readonly unknown[]) => unknown>();
        let finishCleanup: (() => void) | undefined;
        const native = {
            startDictation: vi.fn(async (sessionId: string) => sessionId),
            stopDictation: vi.fn(),
            cancelDictation: vi.fn(
                () =>
                    new Promise<void>((resolve) => {
                        finishCleanup = resolve;
                    })
            ),
        };
        registerVoiceDictation({
            ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
            native: () => native,
            isTrustedFrameUrl: () => true,
        });

        const cancellation = handlers.get(VOICE_DICTATION_CANCEL_CHANNEL)!(trustedEvent, 'session-1');
        let eventLoopTicked = false;
        await new Promise<void>((resolve) =>
            setImmediate(() => {
                eventLoopTicked = true;
                resolve();
            })
        );

        expect(eventLoopTicked).toBe(true);
        expect(native.cancelDictation).toHaveBeenCalledOnce();
        finishCleanup?.();
        await expect(cancellation).resolves.toBeUndefined();
    });
});
