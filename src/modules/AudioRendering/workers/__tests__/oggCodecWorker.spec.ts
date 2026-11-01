// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    OggCodecTestWorker,
    toneSource,
    useRealOggWorkerTransport,
} from '../../repositories/audioEncoders/__tests__/oggCodecTestWorker';
import ogg from '../../repositories/audioEncoders/vendor/vorbis/ogg-encode.js';
import { audioBufferToVorbis } from '../../repositories/audioEncoders/vorbisEncoder';

const cleanup = vi.hoisted(() => ({ calls: 0, fail: false, operationFailure: '' }));
vi.mock('../../repositories/audioEncoders/vendor/vorbis/vorbis.wasm.js', async (importOriginal) => {
    const { default: factory } = await importOriginal<{
        default: () => Promise<{
            _enc_free: (ref: number) => void;
            _enc_init: (ptr: number) => number;
            _enc_encode: (ref: number, frames: number) => number;
            _enc_flush: (ref: number) => number;
        }>;
    }>();
    return {
        default: async () => {
            const module = await factory(),
                original = module._enc_free;
            const init = module._enc_init,
                encode = module._enc_encode,
                flush = module._enc_flush;
            module._enc_init = (ptr: number) => (cleanup.operationFailure === 'init' ? 0 : init(ptr));
            module._enc_encode = (ref: number, frames: number) =>
                cleanup.operationFailure === 'encode' ? -1 : encode(ref, frames);
            module._enc_flush = (ref: number) => (cleanup.operationFailure === 'flush' ? -1 : flush(ref));
            module._enc_free = (ref: number) => {
                cleanup.calls++;
                original(ref);
                if (cleanup.fail) {
                    throw new Error('native cleanup failed');
                }
            };
            return module;
        },
    };
});

beforeEach(() => {
    cleanup.calls = 0;
    cleanup.fail = false;
    cleanup.operationFailure = '';
    useRealOggWorkerTransport();
});
afterEach(() => vi.unstubAllGlobals());

describe('real native Vorbis release', () => {
    it('calls the actual native free exactly once after configuration and never before configuration', async () => {
        const lazy = await ogg({ sampleRate: 48000 });
        lazy.free();
        lazy.free();
        expect(cleanup.calls).toBe(0);
        const configured = await ogg({ sampleRate: 48000, channels: 2, quality: 4 });
        configured.encode([new Float32Array(137), new Float32Array(137)]);
        configured.flush();
        configured.free();
        configured.free();
        expect(cleanup.calls).toBe(1);
    });
    it('settles a native cleanup error and still terminates its owning Worker exactly once', async () => {
        cleanup.fail = true;
        await expect(
            audioBufferToVorbis(toneSource(48000, 1, 137), undefined, { write: async () => {} })
        ).rejects.toThrow('native cleanup failed');
        expect(cleanup.calls).toBe(1);
        expect(OggCodecTestWorker.instances[0]!.terminations).toBe(1);
    });
    it.each(['init', 'encode', 'flush'])(
        'settles a native %s failure and releases only configured state',
        async (failure) => {
            cleanup.operationFailure = failure;
            await expect(
                audioBufferToVorbis(toneSource(48000, 1, 137), undefined, { write: async () => {} })
            ).rejects.toThrow(/initialization failed|Error while encoding/);
            expect(cleanup.calls).toBe(failure === 'init' ? 0 : 1);
            expect(OggCodecTestWorker.instances[0]!.terminations).toBe(1);
        }
    );
});
