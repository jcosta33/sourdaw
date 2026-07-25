import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { serializeLikeTauri } from '#/utils/__tests__/serializeLikeTauri';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { getPluginState } from '../getPluginState';
import { PLUGIN_INSTANCE_HEADER, setPluginState } from '../setPluginState';

/**
 * A representative opaque plugin state chunk. Real CLAP/VST3 state is compressed
 * or otherwise high-entropy, so its bytes are spread across the whole 0..255
 * range — which is precisely what drives the decimal-number-array inflation.
 */
function createRepresentativeStateChunk(): Uint8Array {
    const bytes = new Uint8Array(64 * 1024);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (index * 37) % 256;
    }
    return bytes;
}

function enterTauriWebview(): void {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

describe('native plugin state over binary IPC (OE-5 / WB-5 / M-109)', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        invokeMock.mockResolvedValue(undefined);
    });

    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    });

    describe('the inflation this transport exists to remove', () => {
        it('should inflate the legacy number-array state payload past three times the raw byte length', () => {
            const bytes = createRepresentativeStateChunk();

            const legacy = serializeLikeTauri({ instanceId: 'inst-1', pluginState: Array.from(bytes) });

            expect(legacy.contentType).toBe('application/json');
            expect(legacy.byteLength).toBeGreaterThan(bytes.byteLength * 3);
        });

        it('should inflate identically for a bare Uint8Array field, because Tauri itself calls Array.from', () => {
            const bytes = createRepresentativeStateChunk();

            const viaArrayFrom = serializeLikeTauri({ instanceId: 'inst-1', pluginState: Array.from(bytes) });
            const viaBareTypedArray = serializeLikeTauri({ instanceId: 'inst-1', pluginState: bytes });

            expect(viaBareTypedArray.contentType).toBe('application/json');
            expect(viaBareTypedArray.byteLength).toBe(viaArrayFrom.byteLength);
        });
    });

    describe('setPluginState', () => {
        it('should not reach the bridge outside the desktop app', async () => {
            await setPluginState('inst-1', new Uint8Array([1, 2, 3]));

            expect(invokeMock).not.toHaveBeenCalled();
        });

        it('should send the chunk as the whole message so it crosses as octet-stream at raw byte length', async () => {
            enterTauriWebview();
            const bytes = createRepresentativeStateChunk();

            await setPluginState('inst-1', bytes);

            expect(invokeMock).toHaveBeenCalledTimes(1);
            const [command, message] = invokeMock.mock.calls[0] as [string, unknown];

            expect(command).toBe('set_plugin_state_bytes');
            const serialized = serializeLikeTauri(message);
            expect(serialized.contentType).toBe('application/octet-stream');
            expect(serialized.byteLength).toBe(bytes.byteLength);
        });

        it('should carry the instance id in the percent-encoded instance header', async () => {
            enterTauriWebview();

            await setPluginState('inst-1', new Uint8Array([1, 2, 3]));

            const [, , options] = invokeMock.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
            expect(options.headers[PLUGIN_INSTANCE_HEADER]).toBe('inst-1');
        });

        it('should percent-encode an instance id into a printable-ASCII header value', async () => {
            enterTauriWebview();

            await setPluginState('insté 1/ø', new Uint8Array([1]));

            const [, , options] = invokeMock.mock.calls[0] as [
                string,
                unknown,
                { headers: Record<string, string | undefined> },
            ];
            const encoded = options.headers[PLUGIN_INSTANCE_HEADER] ?? '';

            expect(/^[!-~]+$/.test(encoded)).toBe(true);
            expect(decodeURIComponent(encoded)).toBe('insté 1/ø');
        });

        it('should send byte-identical content to the caller-supplied chunk, including 0x00 and high bytes', async () => {
            enterTauriWebview();
            const bytes = new Uint8Array([0, 1, 127, 128, 200, 254, 255, 0]);

            await setPluginState('inst-1', bytes);

            const [, message] = invokeMock.mock.calls[0] as [string, ArrayBuffer];
            expect(new Uint8Array(message)).toEqual(bytes);
        });

        it('should send only the view window when handed a subarray of a larger buffer', async () => {
            enterTauriWebview();
            const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);

            await setPluginState('inst-1', backing.subarray(2, 5));

            const [, message] = invokeMock.mock.calls[0] as [string, ArrayBuffer];
            expect(new Uint8Array(message)).toEqual(new Uint8Array([1, 2, 3]));
        });
    });

    describe('getPluginState', () => {
        it('should return an empty chunk without reaching the bridge outside the desktop app', async () => {
            const result = await getPluginState('inst-1');

            expect(result).toEqual(new Uint8Array());
            expect(invokeMock).not.toHaveBeenCalled();
        });

        it('should return the ArrayBuffer of a raw ipc::Response as the exact state bytes', async () => {
            enterTauriWebview();
            const expected = createRepresentativeStateChunk();
            invokeMock.mockResolvedValue(expected.buffer);

            const result = await getPluginState('inst-1');

            expect(invokeMock).toHaveBeenCalledWith('get_plugin_state_bytes', { instanceId: 'inst-1' });
            expect(result).toEqual(expected);
        });

        it('should ask for the chunk with a tiny JSON request rather than a binary body', async () => {
            enterTauriWebview();
            invokeMock.mockResolvedValue(new ArrayBuffer(0));

            await getPluginState('inst-1');

            const [, message] = invokeMock.mock.calls[0] as [string, unknown];
            const serialized = serializeLikeTauri(message);

            expect(serialized.contentType).toBe('application/json');
            expect(serialized.byteLength).toBeLessThan(64);
        });

        it('should preserve 0x00 and high bytes returned by the native host', async () => {
            enterTauriWebview();
            const expected = new Uint8Array([0, 128, 255, 0, 1, 254]);
            invokeMock.mockResolvedValue(expected.buffer);

            const result = await getPluginState('inst-1');

            expect(result).toEqual(expected);
        });

        it('should return an empty chunk for a stateless instance rather than throwing', async () => {
            enterTauriWebview();
            invokeMock.mockResolvedValue(new ArrayBuffer(0));

            const result = await getPluginState('inst-1');

            expect(result).toEqual(new Uint8Array());
        });

        it('should still accept a legacy JSON number-array payload and produce identical bytes', async () => {
            enterTauriWebview();
            invokeMock.mockResolvedValue([10, 20, 30, 255, 0]);

            const result = await getPluginState('inst-1');

            expect(result).toEqual(new Uint8Array([10, 20, 30, 255, 0]));
        });

        it('should reject a byte array carrying an out-of-range value', async () => {
            enterTauriWebview();
            invokeMock.mockResolvedValue([10, 999]);

            await expect(getPluginState('inst-1')).rejects.toThrow(
                'get_plugin_state_bytes returned an invalid byte payload'
            );
        });

        it('should reject a payload that is neither a buffer nor a byte array', async () => {
            enterTauriWebview();
            invokeMock.mockResolvedValue({ unexpected: true });

            await expect(getPluginState('inst-1')).rejects.toThrow(
                'get_plugin_state_bytes returned an unsupported payload'
            );
        });
    });

    describe('the improvement the new transport delivers', () => {
        it('should cross at exactly the raw byte length where the legacy shape needed over three times that', async () => {
            enterTauriWebview();
            const bytes = createRepresentativeStateChunk();

            const legacy = serializeLikeTauri({ instanceId: 'inst-1', pluginState: Array.from(bytes) });
            await setPluginState('inst-1', bytes);
            const [, message] = invokeMock.mock.calls[0] as [string, unknown];
            const current = serializeLikeTauri(message);

            expect(current.byteLength).toBe(bytes.byteLength);
            expect(legacy.byteLength / current.byteLength).toBeGreaterThan(3.5);
        });
    });
});
