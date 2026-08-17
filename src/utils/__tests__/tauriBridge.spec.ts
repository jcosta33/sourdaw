import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { invokeMock, listenMock, unlistenMock } = vi.hoisted(() => {
    const invokeMock = vi.fn().mockResolvedValue('invoked');
    const unlistenMock = vi.fn();
    const listenMock = vi.fn().mockResolvedValue(unlistenMock);
    return { invokeMock, listenMock, unlistenMock };
});

const { dialogOpenMock, dialogSaveMock, pathJoinMock } = vi.hoisted(() => {
    const dialogOpenMock = vi.fn().mockResolvedValue('/picked');
    const dialogSaveMock = vi.fn().mockResolvedValue('/saved');
    const pathJoinMock = vi.fn().mockResolvedValue('/joined');
    return { dialogOpenMock, dialogSaveMock, pathJoinMock };
});

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: (...args: unknown[]) => dialogOpenMock(...args),
    save: (...args: unknown[]) => dialogSaveMock(...args),
}));

vi.mock('@tauri-apps/api/path', () => ({
    join: (...args: unknown[]) => pathJoinMock(...args),
    resolveResource: vi.fn(),
}));

import {
    createChannel,
    desktopOpenDialog,
    desktopPathJoin,
    desktopSaveDialog,
    desktopSamplesBaseUrl,
    invokeForBinaryResponse,
    invokeWithBinaryBody,
    isTauri,
    readFileBytes,
    tauriInvoke,
    tauriListen,
    writeFileBytes,
} from '../tauriBridge';

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

// ─── The Electron bridge branch (window.sourdaw) ────────────────────────────

type MutableWindow = Record<string, unknown>;

const createBridgeMock = () => ({
    invoke: vi.fn().mockResolvedValue('bridged'),
    invokeBinary: vi.fn().mockResolvedValue('binary-result'),
    invokeBinaryResponse: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    listen: vi.fn(),
    stream: vi.fn().mockResolvedValue('streamed'),
    dialog: {
        open: vi.fn().mockResolvedValue('/bridge-picked'),
        save: vi.fn().mockResolvedValue('/bridge-saved'),
        message: vi.fn().mockResolvedValue(undefined),
    },
    paths: {
        samplesBase: vi.fn().mockResolvedValue('app://sourdaw/samples'),
        join: vi.fn().mockResolvedValue('/bridge-joined'),
    },
});

const installBridge = (): ReturnType<typeof createBridgeMock> => {
    const bridge = createBridgeMock();
    (window as unknown as MutableWindow).sourdaw = bridge;
    return bridge;
};

describe('the Electron bridge branch', () => {
    afterEach(() => {
        delete (window as unknown as MutableWindow).sourdaw;
        delete (window as unknown as MutableWindow).__TAURI_INTERNALS__;
        vi.clearAllMocks();
    });

    describe('runtime detection order', () => {
        it('should report a desktop runtime from window.sourdaw alone', () => {
            installBridge();
            expect(isTauri()).toBe(true);
        });

        it('should route through the bridge, not Tauri, when both globals are present', async () => {
            const bridge = installBridge();
            (window as unknown as MutableWindow).__TAURI_INTERNALS__ = {};

            await tauriInvoke('list_directory', { path: '/samples' });

            expect(bridge.invoke).toHaveBeenCalledWith('list_directory', ['/samples']);
            expect(invokeMock).not.toHaveBeenCalled();
        });
    });

    describe('named-to-positional argument ordering', () => {
        it('should order load_plugin as (plugin_id, instance_id) — the transposition nothing downstream rejects', async () => {
            const bridge = installBridge();

            await tauriInvoke('load_plugin', { instanceId: 'inst-1', pluginId: 'plug-1' });

            expect(bridge.invoke).toHaveBeenCalledWith('load_plugin', ['plug-1', 'inst-1']);
        });

        it('should send a zero-argument command as an empty array', async () => {
            const bridge = installBridge();

            await tauriInvoke('engine_rt_diagnostics');

            expect(bridge.invoke).toHaveBeenCalledWith('engine_rt_diagnostics', []);
        });

        it('should refuse a command with no positional mapping', async () => {
            installBridge();

            await expect(tauriInvoke('not_a_command', {})).rejects.toThrow(
                'not_a_command has no positional-argument mapping'
            );
        });

        it('should refuse an argument name the command does not take', async () => {
            installBridge();

            await expect(tauriInvoke('list_directory', { pathh: '/x' })).rejects.toThrow(
                'list_directory does not take an argument named pathh'
            );
        });
    });

    describe('byte payload routing', () => {
        it('should route a trailing byte payload through invokeBinary with the preceding args as meta', async () => {
            const bridge = installBridge();
            const audioBytes = new Uint8Array([9, 8, 7]);

            await tauriInvoke('process_plugin_audio', { instanceId: 'inst-1', audioBytes });

            expect(bridge.invokeBinary).toHaveBeenCalledWith('process_plugin_audio', ['inst-1'], audioBytes);
            expect(bridge.invoke).not.toHaveBeenCalled();
        });

        it('should return the binary command result rather than dropping it', async () => {
            installBridge();

            const result = await tauriInvoke('process_plugin_audio', {
                instanceId: 'inst-1',
                audioBytes: new Uint8Array([1]),
            });

            expect(result).toBe('binary-result');
        });

        it('should refuse bytes anywhere but the final argument', async () => {
            installBridge();

            await expect(
                tauriInvoke('load_sample', { instanceId: new Uint8Array([1]), filePath: '/kick.wav' })
            ).rejects.toThrow('load_sample may carry bytes only as its final argument');
        });
    });

    describe('binary body and binary response over the bridge', () => {
        it('should carry writeFileBytes as invokeBinary with the decoded path as meta', async () => {
            const bridge = installBridge();
            const bytes = new Uint8Array([1, 2, 3]);

            await writeFileBytes({ path: '/Users/josé/Música/kick.wav', bytes });

            expect(bridge.invokeBinary).toHaveBeenCalledWith(
                'write_file_bytes',
                ['/Users/josé/Música/kick.wav'],
                bytes
            );
        });

        it('should send only the view window when handed a subarray of a larger buffer', async () => {
            const bridge = installBridge();
            const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);

            await writeFileBytes({ path: '/exports/slice.wav', bytes: backing.subarray(2, 5) });

            const [, , sent] = bridge.invokeBinary.mock.calls[0] as [string, unknown[], Uint8Array];
            expect(sent).toEqual(new Uint8Array([1, 2, 3]));
            expect(sent.buffer.byteLength).toBe(3);
        });

        it('should still enforce the payload ceiling before touching the bridge', async () => {
            const bridge = installBridge();
            const bytes = new Uint8Array();
            Object.defineProperty(bytes, 'byteLength', { value: 1_073_741_825 });

            await expect(writeFileBytes({ path: '/exports/mix.wav', bytes })).rejects.toThrow(
                'write_file_bytes payload exceeds 1073741824-byte IPC limit'
            );
            expect(bridge.invokeBinary).not.toHaveBeenCalled();
        });

        it('should order invokeForBinaryResponse args positionally and return the bridge bytes', async () => {
            const bridge = installBridge();

            const result = await invokeForBinaryResponse({
                command: 'get_plugin_state_bytes',
                args: { instanceId: 'inst-1' },
            });

            expect(bridge.invokeBinaryResponse).toHaveBeenCalledWith('get_plugin_state_bytes', ['inst-1']);
            expect(result).toEqual(new Uint8Array([1, 2, 3]));
        });

        it('should enforce maxBytes on a bridge binary response', async () => {
            const bridge = installBridge();
            bridge.invokeBinaryResponse.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

            await expect(
                invokeForBinaryResponse({ command: 'read_file_bytes', args: { path: '/x' }, maxBytes: 3 })
            ).rejects.toThrow('read_file_bytes payload exceeds 3-byte IPC limit');
        });

        it('should carry invokeWithBinaryBody meta positionally for an addressed payload', async () => {
            const bridge = installBridge();
            const state = new Uint8Array([5, 6]);

            await invokeWithBinaryBody({
                command: 'set_plugin_state_bytes',
                bytes: state,
                headers: { 'x-sourdaw-plugin-instance': encodeURIComponent('inst-1') },
                positionalMeta: ['inst-1'],
            });

            expect(bridge.invokeBinary).toHaveBeenCalledWith('set_plugin_state_bytes', ['inst-1'], state);
        });
    });

    describe('event listening over the bridge', () => {
        it('should deliver the Tauri envelope shape and return the unsubscribe', async () => {
            const bridge = installBridge();
            const unsubscribe = vi.fn();
            bridge.listen.mockReturnValue(unsubscribe);
            const handler = vi.fn();

            const unlisten = await tauriListen('plugin-latency-changed', handler);

            const [eventName, bridgeCallback] = bridge.listen.mock.calls[0] as [string, (payload: unknown) => void];
            expect(eventName).toBe('plugin-latency-changed');

            bridgeCallback({ instance_id: 'inst-1', latency_ms: 64 });
            expect(handler).toHaveBeenCalledWith({
                event: 'plugin-latency-changed',
                payload: { instance_id: 'inst-1', latency_ms: 64 },
            });

            unlisten();
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });

    describe('streamed commands over the bridge', () => {
        it('should route a channel-carrying invoke through stream, dispatching to the current onmessage', async () => {
            const bridge = installBridge();
            const received: unknown[] = [];

            const channel = await createChannel<{ sequence: number }>();
            channel.onmessage = (event) => {
                received.push(event);
            };

            bridge.stream.mockImplementation(
                async (_command: string, _args: readonly unknown[], onEvent: (payload: unknown) => void) => {
                    onEvent({ sequence: 0 });
                    onEvent({ sequence: 1 });
                    return 'streamed';
                }
            );

            const result = await tauriInvoke('provider_gateway_request', {
                requestId: 'req-1',
                adapterId: 'openai',
                origin: 'https://api.openai.com',
                operation: 'request',
                apiKey: 'k',
                body: null,
                onEvent: channel,
            });

            expect(result).toBe('streamed');
            const [command, positional] = bridge.stream.mock.calls[0] as [string, unknown[], unknown];
            expect(command).toBe('provider_gateway_request');
            expect(positional).toEqual(['req-1', 'openai', 'https://api.openai.com', 'request', 'k', null]);
            expect(received).toEqual([{ sequence: 0 }, { sequence: 1 }]);
            expect(bridge.invoke).not.toHaveBeenCalled();
        });
    });

    describe('dialogs and paths', () => {
        it('should route the dialogs through the bridge when present', async () => {
            const bridge = installBridge();

            await desktopOpenDialog({ directory: true, multiple: false, title: 'Pick' });
            await desktopSaveDialog({ defaultPath: 'mix.wav' });

            expect(bridge.dialog.open).toHaveBeenCalledWith({ directory: true, multiple: false, title: 'Pick' });
            expect(bridge.dialog.save).toHaveBeenCalledWith({ defaultPath: 'mix.wav' });
            expect(dialogOpenMock).not.toHaveBeenCalled();
            expect(dialogSaveMock).not.toHaveBeenCalled();
        });

        it('should fall back to the Tauri dialog plugin without the bridge', async () => {
            await desktopOpenDialog({ directory: true });
            await desktopSaveDialog({ defaultPath: 'mix.wav' });

            expect(dialogOpenMock).toHaveBeenCalledWith({ directory: true });
            expect(dialogSaveMock).toHaveBeenCalledWith({ defaultPath: 'mix.wav' });
        });

        it('should join paths through whichever backend is present', async () => {
            await desktopPathJoin('/exports', 'mix.wav');
            expect(pathJoinMock).toHaveBeenCalledWith('/exports', 'mix.wav');

            const bridge = installBridge();
            await desktopPathJoin('/exports', 'mix.wav');
            expect(bridge.paths.join).toHaveBeenCalledWith('/exports', 'mix.wav');
        });

        it('should refuse the samples base URL outside the bridge and answer it inside', async () => {
            await expect(desktopSamplesBaseUrl()).rejects.toThrow('desktopSamplesBaseUrl requires the Sourdaw bridge');

            const bridge = installBridge();
            await expect(desktopSamplesBaseUrl()).resolves.toBe('app://sourdaw/samples');
            expect(bridge.paths.samplesBase).toHaveBeenCalledTimes(1);
        });
    });
});
