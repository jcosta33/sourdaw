/**
 * The command router (REQ-004).
 *
 * Everything here is driven through the handler `ipcMain.handle` would have
 * received, not through a re-implementation of it: a router that is correct in
 * a helper while registering the wrong channel, or registering nothing, is the
 * failure worth catching.
 */
import { describe, expect, it, vi } from 'vitest';

import { commandChannel, DENIED_COMMANDS, EXPOSED_COMMANDS } from '../commands.js';
import {
    registerCommandRouter,
    senderFrameUrl,
    toNativeArguments,
    type CommandStream,
    type IpcMainLike,
    type SenderFrameCarrier,
} from '../router.js';

import type { NativeHost } from '../native.js';

const APP_FRAME: SenderFrameCarrier = { senderFrame: { url: 'app://sourdaw/index.html' } };
const FOREIGN_FRAME: SenderFrameCarrier = { senderFrame: { url: 'https://evil.example/' } };

type Handler = (event: SenderFrameCarrier, ...args: readonly unknown[]) => unknown;

const collectingIpc = (): { ipcMain: IpcMainLike; handlers: Map<string, Handler> } => {
    const handlers = new Map<string, Handler>();
    return { ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) }, handlers };
};

const nullStream = (): CommandStream => ({
    emit: () => undefined,
    failure: () => undefined,
    close: () => undefined,
});

type SetupInput = {
    readonly host?: NativeHost | undefined;
    readonly commands?: readonly string[];
    readonly createStream?: (streamId: string) => CommandStream;
};

const setup = ({ host, commands = ['load_plugin'], createStream = nullStream }: SetupInput) => {
    const { ipcMain, handlers } = collectingIpc();
    registerCommandRouter({
        ipcMain,
        native: () => host,
        isTrustedFrameUrl: (url) => url === APP_FRAME.senderFrame?.url,
        createStream,
        commands,
    });
    return handlers;
};

const hostWith = (methods: Record<string, (...args: readonly unknown[]) => unknown>): NativeHost => ({
    shutdown: () => undefined,
    ...methods,
});

describe('the registered channel table', () => {
    it('registers one channel per exposed command and none for a denied one', () => {
        const { ipcMain, handlers } = collectingIpc();

        registerCommandRouter({
            ipcMain,
            native: () => undefined,
            isTrustedFrameUrl: () => true,
            createStream: nullStream,
        });

        expect(handlers.size).toBe(EXPOSED_COMMANDS.length);
        for (const command of EXPOSED_COMMANDS) {
            expect(handlers.has(commandChannel(command))).toBe(true);
        }
        for (const command of DENIED_COMMANDS) {
            expect(handlers.has(commandChannel(command))).toBe(false);
        }
    });
});

describe('the sender-origin gate', () => {
    it('refuses a foreign frame before it reaches the addon', () => {
        // Thrown synchronously, outside the async body: `ipcMain.handle` turns a
        // synchronous throw into a rejection on the renderer side, and refusing
        // before the handler's first `await` means nothing runs in between.
        const loadPlugin = vi.fn();
        const handlers = setup({ host: hostWith({ loadPlugin }) });
        const handler = handlers.get(commandChannel('load_plugin'));

        expect(() => handler?.(FOREIGN_FRAME, [])).toThrow(/not the application/u);
        expect(loadPlugin).not.toHaveBeenCalled();
    });

    it('reads a destroyed frame as no URL rather than throwing out of the getter', () => {
        expect(
            senderFrameUrl({
                get senderFrame(): { url: string } {
                    throw new Error('frame destroyed');
                },
            })
        ).toBeUndefined();
        expect(senderFrameUrl({ senderFrame: null })).toBeUndefined();
    });
});

describe('argument forwarding', () => {
    it('forwards the positional arguments to the addon method unchanged', async () => {
        const loadPlugin = vi.fn(() => 'loaded');
        const handlers = setup({ host: hostWith({ loadPlugin }) });

        await expect(handlers.get(commandChannel('load_plugin'))?.(APP_FRAME, ['id', 'instance'])).resolves.toBe(
            'loaded'
        );
        expect(loadPlugin).toHaveBeenCalledWith('id', 'instance');
    });

    it('refuses arguments that are not a positional array', async () => {
        const handlers = setup({ host: hostWith({ loadPlugin: vi.fn() }) });
        const handler = handlers.get(commandChannel('load_plugin'));

        await expect(handler?.(APP_FRAME, { pluginId: 'id' })).rejects.toThrow(/positional array/u);
        await expect(handler?.(APP_FRAME, 'id')).rejects.toThrow(/positional array/u);
    });

    it('hands a typed array to the addon as a Buffer, over the same memory', () => {
        // napi-rs's `Buffer` parameter rejects a plain `Uint8Array`, and
        // structured clone delivers one in every direction — so without this
        // every byte-taking command fails at the addon boundary.
        const bytes = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
        const [path, forwarded] = toNativeArguments(['/tmp/x.wav', bytes]);

        expect(path).toBe('/tmp/x.wav');
        expect(Buffer.isBuffer(forwarded)).toBe(true);
        expect(forwarded).toEqual(Buffer.from([2, 3]));
    });

    it('leaves everything that is not bytes alone', () => {
        expect(toNativeArguments(['a', 1, true, null, { nested: [1] }])).toEqual(['a', 1, true, null, { nested: [1] }]);
    });
});

describe('the native host being absent', () => {
    it('refuses rather than answering with undefined', async () => {
        const handlers = setup({ host: undefined });

        await expect(handlers.get(commandChannel('load_plugin'))?.(APP_FRAME, [])).rejects.toThrow(
            /native host is not available/u
        );
    });

    it('names the method an addon build is missing', async () => {
        const handlers = setup({ host: hostWith({}) });

        await expect(handlers.get(commandChannel('load_plugin'))?.(APP_FRAME, [])).rejects.toThrow(
            /does not implement loadPlugin/u
        );
    });
});

describe('streaming commands', () => {
    const streamingSetup = (stream: CommandStream, implementation: (...args: readonly unknown[]) => unknown) =>
        setup({
            host: hostWith({ providerGatewayRequest: implementation }),
            commands: ['provider_gateway_request'],
            createStream: () => stream,
        });

    it('appends the stream emitter as the final argument', async () => {
        const stream = nullStream();
        const request = vi.fn(() => 'done');
        const handlers = streamingSetup(stream, request);

        await handlers.get(commandChannel('provider_gateway_request'))?.(APP_FRAME, ['req-1', 'adapter'], 's0');

        expect(request).toHaveBeenCalledWith('req-1', 'adapter', stream.emit);
    });

    it('fails the request when the stream overflowed, rather than answering short', async () => {
        // The whole reason the stream is bounded: a response body missing a
        // chunk decodes as if it were complete, so the caller has to be told
        // the request failed.
        const stream: CommandStream = { ...nullStream(), failure: () => 'the response stream overflowed' };
        const handlers = streamingSetup(stream, () => 'done');

        await expect(
            handlers.get(commandChannel('provider_gateway_request'))?.(APP_FRAME, ['req-1'], 's0')
        ).rejects.toThrow(/the response stream overflowed/u);
    });

    it('closes the stream on both the success and the failure path', async () => {
        const close = vi.fn();
        const stream: CommandStream = { ...nullStream(), close };
        const handlers = streamingSetup(stream, () => {
            throw new Error('gateway refused');
        });

        await expect(
            handlers.get(commandChannel('provider_gateway_request'))?.(APP_FRAME, ['req-1'], 's0')
        ).rejects.toThrow(/gateway refused/u);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('refuses a stream id that is not a string', async () => {
        const handlers = streamingSetup(nullStream(), () => 'done');

        await expect(handlers.get(commandChannel('provider_gateway_request'))?.(APP_FRAME, [], 7)).rejects.toThrow(
            /non-string stream id/u
        );
    });
});
