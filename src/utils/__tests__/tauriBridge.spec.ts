import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { invokeMock, listenMock, unlistenMock } = vi.hoisted(() => {
    const invokeMock = vi.fn().mockResolvedValue('invoked');
    const unlistenMock = vi.fn();
    const listenMock = vi.fn().mockResolvedValue(unlistenMock);
    return { invokeMock, listenMock, unlistenMock };
});

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: (...args: unknown[]) => listenMock(...args),
}));

import { isTauri, readFileBytes, tauriInvoke, tauriListen, writeFileBytes } from '../tauriBridge';

import { serializeLikeTauri } from './serializeLikeTauri';

describe('tauriBridge', () => {
    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    });

    describe('isTauri', () => {
        it('should return false when __TAURI_INTERNALS__ is absent', () => {
            expect(isTauri()).toBe(false);
        });

        it('should return true when __TAURI_INTERNALS__ is on window', () => {
            (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
            expect(isTauri()).toBe(true);
        });
    });

    it('should forward tauriInvoke to invoke', async () => {
        const result = await tauriInvoke('my_cmd', { x: 1 });
        expect(invokeMock).toHaveBeenCalledWith('my_cmd', { x: 1 });
        expect(result).toBe('invoked');
    });

    it('should forward tauriListen to listen', async () => {
        const handler = vi.fn();
        const unlisten = await tauriListen('evt', handler);
        expect(listenMock).toHaveBeenCalledWith('evt', handler);
        expect(unlisten).toBe(unlistenMock);
    });
});

/** One second of 48 kHz 16-bit stereo PCM — a small but representative export payload. */
function createRepresentativeAudioBytes(): Uint8Array {
    const bytes = new Uint8Array(48_000 * 2 * 2);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (index * 31) % 256;
    }
    return bytes;
}

describe('binary file IPC (OE-5 / WB-5 / M-109)', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        invokeMock.mockResolvedValue(undefined);
    });

    describe('the inflation this transport exists to remove', () => {
        it('should inflate a JSON number-array payload past three times the raw byte length', () => {
            const bytes = createRepresentativeAudioBytes();

            const legacy = serializeLikeTauri({ path: '/exports/mix.wav', data: Array.from(bytes) });

            expect(legacy.contentType).toBe('application/json');
            expect(legacy.byteLength).toBeGreaterThan(bytes.byteLength * 3);
        });

        it('should inflate identically for a bare Uint8Array field, because Tauri itself calls Array.from', () => {
            const bytes = createRepresentativeAudioBytes();

            const viaArrayFrom = serializeLikeTauri({ path: '/exports/mix.wav', data: Array.from(bytes) });
            const viaBareTypedArray = serializeLikeTauri({ path: '/exports/mix.wav', data: bytes });

            expect(viaBareTypedArray.contentType).toBe('application/json');
            expect(viaBareTypedArray.byteLength).toBe(viaArrayFrom.byteLength);
        });
    });

    describe('writeFileBytes', () => {
        it('should send the buffer as the whole message so it crosses as octet-stream at raw byte length', async () => {
            const bytes = createRepresentativeAudioBytes();

            await writeFileBytes({ path: '/exports/mix.wav', bytes });

            expect(invokeMock).toHaveBeenCalledTimes(1);
            const [command, message, options] = invokeMock.mock.calls[0] as [
                string,
                unknown,
                { headers: Record<string, string> },
            ];

            expect(command).toBe('write_file_bytes');
            expect(options.headers['x-sourdaw-path']).toBe(encodeURIComponent('/exports/mix.wav'));

            const serialized = serializeLikeTauri(message);
            expect(serialized.contentType).toBe('application/octet-stream');
            expect(serialized.byteLength).toBe(bytes.byteLength);
        });

        it('should send byte-identical content to the caller-supplied buffer', async () => {
            const bytes = createRepresentativeAudioBytes();

            await writeFileBytes({ path: '/exports/mix.wav', bytes });

            const [, message] = invokeMock.mock.calls[0] as [string, ArrayBuffer];
            expect(new Uint8Array(message)).toEqual(bytes);
        });

        it('should percent-encode a non-ASCII path into a printable-ASCII header value', async () => {
            await writeFileBytes({ path: '/Users/josé/Música/kick.wav', bytes: new Uint8Array([1, 2, 3]) });

            const [, , options] = invokeMock.mock.calls[0] as [
                string,
                unknown,
                { headers: Record<string, string | undefined> },
            ];
            const encoded = options.headers['x-sourdaw-path'] ?? '';

            expect(/^[!-~]+$/.test(encoded)).toBe(true);
            expect(decodeURIComponent(encoded)).toBe('/Users/josé/Música/kick.wav');
        });

        it('should send an empty body without throwing when the buffer is empty', async () => {
            await writeFileBytes({ path: '/exports/empty.wav', bytes: new Uint8Array() });

            const [, message] = invokeMock.mock.calls[0] as [string, ArrayBuffer];
            expect(new Uint8Array(message).byteLength).toBe(0);
        });

        it('should send only the view window when handed a subarray of a larger buffer', async () => {
            const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);

            await writeFileBytes({ path: '/exports/slice.wav', bytes: backing.subarray(2, 5) });

            const [, message] = invokeMock.mock.calls[0] as [string, ArrayBuffer];
            expect(new Uint8Array(message)).toEqual(new Uint8Array([1, 2, 3]));
        });

        it('should reject an oversized binary request before invoking native code', async () => {
            const bytes = new Uint8Array();
            Object.defineProperty(bytes, 'byteLength', { value: 1_073_741_825 });

            await expect(writeFileBytes({ path: '/exports/mix.wav', bytes })).rejects.toThrow(
                'write_file_bytes payload exceeds 1073741824-byte IPC limit'
            );
            expect(invokeMock).not.toHaveBeenCalled();
        });

        it('should reject an oversized path before placing it in an IPC header', async () => {
            await expect(writeFileBytes({ path: `/${'x'.repeat(4096)}`, bytes: new Uint8Array() })).rejects.toThrow(
                'Native file path exceeds 4096-byte IPC limit'
            );
            expect(invokeMock).not.toHaveBeenCalled();
        });
    });

    describe('readFileBytes', () => {
        it('should return the ArrayBuffer of a raw ipc::Response as bytes', async () => {
            const expected = createRepresentativeAudioBytes();
            invokeMock.mockResolvedValue(expected.buffer);

            const result = await readFileBytes({ path: '/samples/kick.wav' });

            expect(invokeMock).toHaveBeenCalledWith('read_file_bytes', { path: '/samples/kick.wav' });
            expect(result).toEqual(expected);
        });

        it('should still accept a legacy JSON number-array payload and produce identical bytes', async () => {
            invokeMock.mockResolvedValue([10, 20, 30, 255, 0]);

            const result = await readFileBytes({ path: '/samples/kick.wav' });

            expect(result).toEqual(new Uint8Array([10, 20, 30, 255, 0]));
        });

        it('should return an empty Uint8Array for an empty file rather than throwing', async () => {
            invokeMock.mockResolvedValue(new ArrayBuffer(0));

            const result = await readFileBytes({ path: '/samples/empty.wav' });

            expect(result).toEqual(new Uint8Array());
        });

        it('should reject a byte array carrying an out-of-range value', async () => {
            invokeMock.mockResolvedValue([10, 999]);

            await expect(readFileBytes({ path: '/samples/kick.wav' })).rejects.toThrow(
                'read_file_bytes returned an invalid byte payload'
            );
        });

        it('should reject a payload that is neither a buffer nor a byte array', async () => {
            invokeMock.mockResolvedValue({ unexpected: true });

            await expect(readFileBytes({ path: '/samples/kick.wav' })).rejects.toThrow(
                'read_file_bytes returned an unsupported payload'
            );
        });

        it('should reject an oversized binary response before allocating a typed view', async () => {
            const response = new ArrayBuffer(0);
            Object.defineProperty(response, 'byteLength', { value: 1_073_741_825 });
            invokeMock.mockResolvedValue(response);

            await expect(readFileBytes({ path: '/samples/kick.wav' })).rejects.toThrow(
                'read_file_bytes payload exceeds 1073741824-byte IPC limit'
            );
        });
    });

    it('should carry a representative export buffer out and back byte-for-byte', async () => {
        const original = createRepresentativeAudioBytes();

        await writeFileBytes({ path: '/exports/mix.wav', bytes: original });
        const [, sent] = invokeMock.mock.calls[0] as [string, ArrayBuffer];

        invokeMock.mockResolvedValue(sent);
        const readBack = await readFileBytes({ path: '/exports/mix.wav' });

        expect(readBack).toEqual(original);
    });
});
