import { describe, it, expect, vi, afterEach } from 'vitest';

import { getPluginState } from '../getPluginState';
import { setPluginState } from '../setPluginState';

type MutableWindow = Record<string, unknown>;

const createBridgeMock = () => ({
    invokeBinary: vi.fn().mockResolvedValue(undefined),
    invokeBinaryResponse: vi.fn().mockResolvedValue(new Uint8Array()),
});

const installBridge = (): ReturnType<typeof createBridgeMock> => {
    const bridge = createBridgeMock();
    (window as unknown as MutableWindow).sourdaw = bridge;
    return bridge;
};

/**
 * A representative opaque plugin state chunk. Real CLAP/VST3 state is compressed
 * or otherwise high-entropy, so its bytes are spread across the whole 0..255
 * range — which is precisely what drove the decimal-number-array inflation the
 * binary path exists to remove.
 */
function createRepresentativeStateChunk(): Uint8Array {
    const bytes = new Uint8Array(64 * 1024);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (index * 37) % 256;
    }
    return bytes;
}

describe('native plugin state over binary IPC (OE-5 / WB-5 / M-109)', () => {
    afterEach(() => {
        delete (window as unknown as MutableWindow).sourdaw;
        vi.clearAllMocks();
    });

    describe('setPluginState', () => {
        it('should not reach the bridge outside the desktop app', async () => {
            // With no `window.sourdaw`, any bridge call would throw; resolving
            // quietly is what proves the runtime gate held.
            await expect(setPluginState('inst-1', new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
        });

        it('should hand the chunk to the binary channel at exactly its raw byte length', async () => {
            const bridge = installBridge();
            const bytes = createRepresentativeStateChunk();

            await setPluginState('inst-1', bytes);

            expect(bridge.invokeBinary).toHaveBeenCalledTimes(1);
            const [command, , payload] = bridge.invokeBinary.mock.calls[0] as [string, unknown[], Uint8Array];

            expect(command).toBe('set_plugin_state_bytes');
            expect(payload.byteLength).toBe(bytes.byteLength);
        });

        it('should carry the instance id as positional meta beside the chunk', async () => {
            const bridge = installBridge();

            await setPluginState('inst-1', new Uint8Array([1, 2, 3]));

            const [, meta] = bridge.invokeBinary.mock.calls[0] as [string, unknown[], Uint8Array];
            expect(meta).toEqual(['inst-1']);
        });

        it('should send byte-identical content to the caller-supplied chunk, including 0x00 and high bytes', async () => {
            const bridge = installBridge();
            const bytes = new Uint8Array([0, 1, 127, 128, 200, 254, 255, 0]);

            await setPluginState('inst-1', bytes);

            const [, , payload] = bridge.invokeBinary.mock.calls[0] as [string, unknown[], Uint8Array];
            expect(payload).toEqual(bytes);
        });

        it('should send only the view window when handed a subarray of a larger buffer', async () => {
            const bridge = installBridge();
            const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);

            await setPluginState('inst-1', backing.subarray(2, 5));

            const [, , payload] = bridge.invokeBinary.mock.calls[0] as [string, unknown[], Uint8Array];
            expect(payload).toEqual(new Uint8Array([1, 2, 3]));
        });
    });

    describe('getPluginState', () => {
        it('should return an empty chunk without reaching the bridge outside the desktop app', async () => {
            // Same gate as setPluginState: a bridge call here would throw.
            await expect(getPluginState('inst-1')).resolves.toEqual(new Uint8Array());
        });

        it('should return the bytes the native host answered with as the exact state chunk', async () => {
            const bridge = installBridge();
            const expected = createRepresentativeStateChunk();
            bridge.invokeBinaryResponse.mockResolvedValue(expected);

            const result = await getPluginState('inst-1');

            expect(bridge.invokeBinaryResponse).toHaveBeenCalledWith('get_plugin_state_bytes', ['inst-1']);
            expect(result).toEqual(expected);
        });

        it('should ask for the chunk with a tiny argument list rather than a binary body', async () => {
            const bridge = installBridge();

            await getPluginState('inst-1');

            expect(bridge.invokeBinary).not.toHaveBeenCalled();
            const [, meta] = bridge.invokeBinaryResponse.mock.calls[0] as [string, unknown[]];
            expect(meta).toEqual(['inst-1']);
        });

        it('should preserve 0x00 and high bytes returned by the native host', async () => {
            const bridge = installBridge();
            const expected = new Uint8Array([0, 128, 255, 0, 1, 254]);
            bridge.invokeBinaryResponse.mockResolvedValue(expected);

            const result = await getPluginState('inst-1');

            expect(result).toEqual(expected);
        });

        it('should return an empty chunk for a stateless instance rather than throwing', async () => {
            const bridge = installBridge();
            bridge.invokeBinaryResponse.mockResolvedValue(new Uint8Array());

            const result = await getPluginState('inst-1');

            expect(result).toEqual(new Uint8Array());
        });
    });
});
