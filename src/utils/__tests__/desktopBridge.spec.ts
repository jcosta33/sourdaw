import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    createChannel,
    desktopOpenDialog,
    desktopPathJoin,
    desktopPlatform,
    desktopSaveDialog,
    desktopSamplesBaseUrl,
    desktopWindowControls,
    invokeForBinaryResponse,
    invokeWithBinaryBody,
    isDesktopRuntime,
    readFileBytes,
    desktopInvoke,
    desktopListen,
    usesFramelessWindowChrome,
    writeFileBytes,
} from '../desktopBridge';

type MutableWindow = Record<string, unknown>;

const createBridgeMock = (platform = 'linux') => ({
    platform,
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
    windowControls: {
        minimize: vi.fn().mockResolvedValue(undefined),
        toggleMaximize: vi.fn().mockResolvedValue(true),
        close: vi.fn().mockResolvedValue(undefined),
        isMaximized: vi.fn().mockResolvedValue(false),
        listenMaximized: vi.fn().mockReturnValue(() => undefined),
    },
});

const installBridge = (platform = 'linux'): ReturnType<typeof createBridgeMock> => {
    const bridge = createBridgeMock(platform);
    (window as unknown as MutableWindow).sourdaw = bridge;
    return bridge;
};

/** One second of 48 kHz 16-bit stereo PCM — a small but representative export payload. */
function createRepresentativeAudioBytes(): Uint8Array {
    const bytes = new Uint8Array(48_000 * 2 * 2);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (index * 31) % 256;
    }
    return bytes;
}

describe('desktopBridge', () => {
    afterEach(() => {
        delete (window as unknown as MutableWindow).sourdaw;
        vi.clearAllMocks();
    });

    describe('runtime detection', () => {
        it('should report no desktop runtime without the preload bridge', () => {
            expect(isDesktopRuntime()).toBe(false);
        });

        it('should report a desktop runtime from window.sourdaw alone', () => {
            installBridge();
            expect(isDesktopRuntime()).toBe(true);
        });
    });

    describe('refusal without the bridge', () => {
        it.each([
            ['desktopInvoke', async () => desktopInvoke('list_directory', { path: '/samples' })],
            ['desktopListen', async () => desktopListen('evt', () => undefined)],
            ['desktopOpenDialog', async () => desktopOpenDialog({ directory: true })],
            ['desktopSaveDialog', async () => desktopSaveDialog({ defaultPath: 'mix.wav' })],
            ['desktopPathJoin', async () => desktopPathJoin('/exports', 'mix.wav')],
            ['desktopSamplesBaseUrl', async () => desktopSamplesBaseUrl()],
        ])('should refuse %s loudly rather than silently no-op', async (_name, call) => {
            await expect(call()).rejects.toThrow('Sourdaw desktop bridge is not available');
        });

        it('should refuse the synchronous window-control accessors loudly too', () => {
            expect(() => desktopWindowControls()).toThrow('Sourdaw desktop bridge is not available');
        });

        it('should answer the platform probes without the bridge rather than throwing', () => {
            expect(desktopPlatform()).toBeNull();
            expect(usesFramelessWindowChrome()).toBe(false);
        });
    });

    describe('window chrome', () => {
        it('should read the platform from the bridge', () => {
            installBridge('linux');
            expect(desktopPlatform()).toBe('linux');
        });

        it('should treat only the linux desktop build as frameless chrome', () => {
            installBridge('linux');
            expect(usesFramelessWindowChrome()).toBe(true);

            installBridge('darwin');
            expect(usesFramelessWindowChrome()).toBe(false);

            installBridge('win32');
            expect(usesFramelessWindowChrome()).toBe(false);
        });

        it('should hand the window-control surface through', async () => {
            const bridge = installBridge();

            await desktopWindowControls().minimize();
            await desktopWindowControls().close();
            await expect(desktopWindowControls().toggleMaximize()).resolves.toBe(true);
            await expect(desktopWindowControls().isMaximized()).resolves.toBe(false);

            expect(bridge.windowControls.minimize).toHaveBeenCalledTimes(1);
            expect(bridge.windowControls.close).toHaveBeenCalledTimes(1);
            expect(bridge.windowControls.toggleMaximize).toHaveBeenCalledTimes(1);
            expect(bridge.windowControls.isMaximized).toHaveBeenCalledTimes(1);
        });
    });

    describe('named-to-positional argument ordering', () => {
        it('should order load_plugin as (plugin_id, instance_id) — the transposition nothing downstream rejects', async () => {
            const bridge = installBridge();

            await desktopInvoke('load_plugin', { instanceId: 'inst-1', pluginId: 'plug-1' });

            expect(bridge.invoke).toHaveBeenCalledWith('load_plugin', ['plug-1', 'inst-1']);
        });

        it('should send a zero-argument command as an empty array', async () => {
            const bridge = installBridge();

            await desktopInvoke('engine_rt_diagnostics');

            expect(bridge.invoke).toHaveBeenCalledWith('engine_rt_diagnostics', []);
        });

        it('should refuse a command with no positional mapping', async () => {
            installBridge();

            await expect(desktopInvoke('not_a_command', {})).rejects.toThrow(
                'not_a_command has no positional-argument mapping'
            );
        });

        it('should refuse an argument name the command does not take', async () => {
            installBridge();

            await expect(desktopInvoke('list_directory', { pathh: '/x' })).rejects.toThrow(
                'list_directory does not take an argument named pathh'
            );
        });
    });

    describe('byte payload routing', () => {
        it('should route a trailing byte payload through invokeBinary with the preceding args as meta', async () => {
            const bridge = installBridge();
            const audioBytes = new Uint8Array([9, 8, 7]);

            await desktopInvoke('process_plugin_audio', { instanceId: 'inst-1', audioBytes });

            expect(bridge.invokeBinary).toHaveBeenCalledWith('process_plugin_audio', ['inst-1'], audioBytes);
            expect(bridge.invoke).not.toHaveBeenCalled();
        });

        it('should return the binary command result rather than dropping it', async () => {
            installBridge();

            const result = await desktopInvoke('process_plugin_audio', {
                instanceId: 'inst-1',
                audioBytes: new Uint8Array([1]),
            });

            expect(result).toBe('binary-result');
        });

        it('should refuse bytes anywhere but the final argument', async () => {
            installBridge();

            await expect(
                desktopInvoke('load_sample', { instanceId: new Uint8Array([1]), filePath: '/kick.wav' })
            ).rejects.toThrow('load_sample may carry bytes only as its final argument');
        });
    });

    describe('binary body and binary response', () => {
        it('should carry writeFileBytes as invokeBinary with the path as meta', async () => {
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

        it('should send an empty body without throwing when the buffer is empty', async () => {
            const bridge = installBridge();

            await writeFileBytes({ path: '/exports/empty.wav', bytes: new Uint8Array() });

            const [, , sent] = bridge.invokeBinary.mock.calls[0] as [string, unknown[], Uint8Array];
            expect(sent.byteLength).toBe(0);
        });

        it('should enforce the payload ceiling before touching the bridge', async () => {
            const bridge = installBridge();
            const bytes = new Uint8Array();
            Object.defineProperty(bytes, 'byteLength', { value: 1_073_741_825 });

            await expect(writeFileBytes({ path: '/exports/mix.wav', bytes })).rejects.toThrow(
                'write_file_bytes payload exceeds 1073741824-byte IPC limit'
            );
            expect(bridge.invokeBinary).not.toHaveBeenCalled();
        });

        it('should reject an oversized path before handing it to the bridge', async () => {
            const bridge = installBridge();

            await expect(writeFileBytes({ path: `/${'x'.repeat(4096)}`, bytes: new Uint8Array() })).rejects.toThrow(
                'Native file path exceeds 4096-byte IPC limit'
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

        it('should enforce maxBytes on a binary response', async () => {
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
                positionalMeta: ['inst-1'],
            });

            expect(bridge.invokeBinary).toHaveBeenCalledWith('set_plugin_state_bytes', ['inst-1'], state);
        });

        it('should carry a representative export buffer out and back byte-for-byte', async () => {
            const bridge = installBridge();
            const original = createRepresentativeAudioBytes();

            await writeFileBytes({ path: '/exports/mix.wav', bytes: original });
            const [, , sent] = bridge.invokeBinary.mock.calls[0] as [string, unknown[], Uint8Array];

            bridge.invokeBinaryResponse.mockResolvedValue(sent);
            const readBack = await readFileBytes({ path: '/exports/mix.wav' });

            expect(readBack).toEqual(original);
        });
    });

    describe('event listening', () => {
        it('should deliver the envelope shape and return the unsubscribe', async () => {
            const bridge = installBridge();
            const unsubscribe = vi.fn();
            bridge.listen.mockReturnValue(unsubscribe);
            const handler = vi.fn();

            const unlisten = await desktopListen('plugin-latency-changed', handler);

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

    describe('streamed commands', () => {
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

            const result = await desktopInvoke('provider_gateway_request', {
                requestId: 'req-1',
                sessionId: 'sess-1',
                operation: 'request',
                body: null,
                onEvent: channel,
            });

            expect(result).toBe('streamed');
            const [command, positional] = bridge.stream.mock.calls[0] as [string, unknown[], unknown];
            expect(command).toBe('provider_gateway_request');
            expect(positional).toEqual(['req-1', 'sess-1', 'request', null]);
            expect(received).toEqual([{ sequence: 0 }, { sequence: 1 }]);
            expect(bridge.invoke).not.toHaveBeenCalled();
        });
    });

    describe('dialogs and paths', () => {
        it('should route the dialogs through the bridge', async () => {
            const bridge = installBridge();

            await desktopOpenDialog({ directory: true, multiple: false, title: 'Pick' });
            await desktopSaveDialog({ defaultPath: 'mix.wav' });

            expect(bridge.dialog.open).toHaveBeenCalledWith({ directory: true, multiple: false, title: 'Pick' });
            expect(bridge.dialog.save).toHaveBeenCalledWith({ defaultPath: 'mix.wav' });
        });

        it('should join paths through the bridge', async () => {
            const bridge = installBridge();

            await desktopPathJoin('/exports', 'mix.wav');

            expect(bridge.paths.join).toHaveBeenCalledWith('/exports', 'mix.wav');
        });

        it('should answer the samples base URL from the bridge', async () => {
            const bridge = installBridge();

            await expect(desktopSamplesBaseUrl()).resolves.toBe('app://sourdaw/samples');
            expect(bridge.paths.samplesBase).toHaveBeenCalledTimes(1);
        });
    });
});
