/**
 * The renderer-side bridge (REQ-004, REQ-006).
 *
 * `preload.ts` is four lines with no branches, so everything worth pinning is
 * here: that the published surface is exactly the one the requirement names,
 * that a denied command never reaches IPC at all, that bytes cannot take the
 * JSON path, and that the two fan-in maps unsubscribe rather than leak.
 */
import { describe, expect, it, vi } from 'vitest';

import { createSourdawBridge, type RendererIpc } from '../bridge.js';
import {
    EVENT_CHANNEL,
    PATHS_JOIN_CHANNEL,
    PATHS_SAMPLES_BASE_CHANNEL,
    STREAM_CHANNEL,
    DIALOG_MESSAGE_CHANNEL,
    DIALOG_OPEN_CHANNEL,
    DIALOG_SAVE_CHANNEL,
} from '../channels.js';
import { commandChannel, DENIED_COMMANDS } from '../commands.js';

type Fake = {
    readonly ipc: RendererIpc;
    readonly invoke: ReturnType<typeof vi.fn>;
    readonly push: (channel: string, ...args: readonly unknown[]) => void;
    readonly channelListeners: () => Map<string, number>;
};

const fakeIpc = (answer: (channel: string, args: readonly unknown[]) => unknown = () => undefined): Fake => {
    const listeners = new Map<string, ((event: unknown, ...args: readonly unknown[]) => void)[]>();
    const invoke = vi.fn(async (channel: string, ...args: readonly unknown[]) => answer(channel, args));
    return {
        invoke,
        ipc: {
            invoke,
            on: (channel, listener) => {
                listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
            },
        },
        push: (channel, ...args) => {
            for (const listener of listeners.get(channel) ?? []) {
                listener({}, ...args);
            }
        },
        channelListeners: () => new Map([...listeners].map(([channel, list]) => [channel, list.length])),
    };
};

describe('the published surface', () => {
    it('exposes exactly the members the renderer is given', () => {
        // Anything extra here is a capability the renderer gains for free, and
        // `contextBridge` publishes whatever it is handed.
        const bridge = createSourdawBridge(fakeIpc().ipc);

        expect(Object.keys(bridge).sort()).toEqual([
            'dialog',
            'invoke',
            'invokeBinary',
            'invokeBinaryResponse',
            'listen',
            'paths',
            'stream',
        ]);
        expect(Object.keys(bridge.dialog).sort()).toEqual(['message', 'open', 'save']);
        expect(Object.keys(bridge.paths).sort()).toEqual(['join', 'samplesBase']);
    });

    it('registers one process-wide listener per push channel, not one per subscription', () => {
        // One `ipcRenderer.on` per `listen` call would grow with every hook
        // mount and trip the max-listener warning during ordinary use.
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);

        for (let index = 0; index < 50; index += 1) {
            bridge.listen('midi-message', () => undefined);
        }

        expect(fake.channelListeners()).toEqual(
            new Map([
                [EVENT_CHANNEL, 1],
                [STREAM_CHANNEL, 1],
            ])
        );
    });
});

describe('command admission', () => {
    it('sends an exposed command down its own channel, with positional arguments', async () => {
        const fake = fakeIpc(() => 'ok');
        const bridge = createSourdawBridge(fake.ipc);

        await expect(bridge.invoke('load_plugin', ['id', 'instance'])).resolves.toBe('ok');
        expect(fake.invoke).toHaveBeenCalledWith(commandChannel('load_plugin'), ['id', 'instance']);
    });

    it('refuses every denied command before any IPC happens', async () => {
        // "No preload path" is the requirement, and a call that reaches the
        // channel and is refused there is still a path.
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);

        for (const command of DENIED_COMMANDS) {
            await expect(bridge.invoke(command)).rejects.toThrow(/Unknown or denied/u);
        }
        await expect(bridge.invoke('rm_rf')).rejects.toThrow(/Unknown or denied/u);
        await expect(bridge.stream('load_whisper_model', [], () => undefined)).rejects.toThrow(/Unknown or denied/u);
        await expect(bridge.invokeBinaryResponse('read_audio_file')).rejects.toThrow(/Unknown or denied/u);
        expect(fake.invoke).not.toHaveBeenCalled();
    });
});

describe('byte payloads', () => {
    it('refuses to carry bytes down the JSON path', async () => {
        // Structured clone would happily move a `Uint8Array`, but the addon's
        // JSON-taking methods would then receive a number array. Failing here
        // names the mistake instead of producing a corrupt argument.
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);

        await expect(bridge.invoke('write_file_bytes', ['/tmp/x', new Uint8Array([1])])).rejects.toThrow(
            /use invokeBinary/u
        );
        expect(fake.invoke).not.toHaveBeenCalled();
    });

    it('puts the byte payload last, after the metadata arguments', async () => {
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);
        const bytes = new Uint8Array([1, 2, 3]);

        await bridge.invokeBinary('write_file_bytes', ['/tmp/x.wav'], bytes);

        expect(fake.invoke).toHaveBeenCalledWith(commandChannel('write_file_bytes'), ['/tmp/x.wav', bytes]);
    });

    it('refuses a second byte payload and a non-byte one', async () => {
        const bridge = createSourdawBridge(fakeIpc().ipc);

        await expect(
            bridge.invokeBinary('write_file_bytes', [new Uint8Array([1])], new Uint8Array([2]))
        ).rejects.toThrow(/only one byte payload/u);
        await expect(
            // The renderer is untyped at the boundary, so this is reachable.
            bridge.invokeBinary('write_file_bytes', ['/tmp/x'], [1, 2, 3] as unknown as Uint8Array)
        ).rejects.toThrow(/expects a Uint8Array/u);
    });

    it('hands back the bytes it was given, without copying them', async () => {
        // Structured clone turns the addon's Node `Buffer` into a plain
        // `Uint8Array` on the renderer side, which is already the wanted shape.
        // Copying it here would double the peak memory of every sample load.
        const bytes = new Uint8Array([4, 5, 6]);
        const bridge = createSourdawBridge(fakeIpc(() => bytes).ipc);

        await expect(bridge.invokeBinaryResponse('read_file_bytes', ['/tmp/x'])).resolves.toBe(bytes);
    });

    it('wraps a bare ArrayBuffer rather than refusing it', async () => {
        const bridge = createSourdawBridge(fakeIpc(() => new Uint8Array([4, 5, 6]).buffer).ipc);

        const result = await bridge.invokeBinaryResponse('read_file_bytes');

        expect(result).toBeInstanceOf(Uint8Array);
        expect([...result]).toEqual([4, 5, 6]);
    });

    it('fails loudly when a byte command answers with something else', async () => {
        // Silently handing back a number array here would be decoded as audio.
        const bridge = createSourdawBridge(fakeIpc(() => [4, 5, 6]).ipc);

        await expect(bridge.invokeBinaryResponse('read_file_bytes')).rejects.toThrow(/unsupported payload/u);
    });
});

describe('pushed event subscriptions', () => {
    it('delivers to every listener of the named event and to no other', () => {
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);
        const first = vi.fn();
        const second = vi.fn();
        const other = vi.fn();

        bridge.listen('midi-message', first);
        bridge.listen('midi-message', second);
        bridge.listen('dictation-result', other);
        fake.push(EVENT_CHANNEL, 'midi-message', { note: 60 });

        expect(first).toHaveBeenCalledWith({ note: 60 });
        expect(second).toHaveBeenCalledWith({ note: 60 });
        expect(other).not.toHaveBeenCalled();
    });

    it('stops delivering once unsubscribed, without disturbing the others', () => {
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);
        const kept = vi.fn();
        const dropped = vi.fn();

        bridge.listen('midi-message', kept);
        bridge.listen('midi-message', dropped)();
        fake.push(EVENT_CHANNEL, 'midi-message', { note: 60 });

        expect(kept).toHaveBeenCalledTimes(1);
        expect(dropped).not.toHaveBeenCalled();
    });

    it('survives a listener that unsubscribes itself while being called', () => {
        // The one-shot progress subscriptions do exactly this, and iterating the
        // live set would skip the listener after it.
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);
        const after = vi.fn();
        const unsubscribe = bridge.listen('pitch-analysis-progress', () => unsubscribe());
        bridge.listen('pitch-analysis-progress', after);

        expect(() => fake.push(EVENT_CHANNEL, 'pitch-analysis-progress', { progress: 1 })).not.toThrow();
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('ignores a malformed push rather than throwing into the IPC listener', () => {
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);
        bridge.listen('midi-message', vi.fn());

        expect(() => fake.push(EVENT_CHANNEL, 7, {})).not.toThrow();
        expect(() => fake.push(STREAM_CHANNEL, undefined, {})).not.toThrow();
    });
});

describe('streaming commands', () => {
    it('correlates events to the caller that started the stream', async () => {
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);
        const first: unknown[] = [];
        const second: unknown[] = [];

        const firstCall = bridge.stream('provider_gateway_request', ['a'], (payload) => first.push(payload));
        const secondCall = bridge.stream('provider_gateway_request', ['b'], (payload) => second.push(payload));

        const streamIds = fake.invoke.mock.calls.map((call) => call[2]);
        expect(new Set(streamIds).size).toBe(2);
        for (const [index, streamId] of streamIds.entries()) {
            fake.push(STREAM_CHANNEL, streamId, { from: index });
        }
        await Promise.all([firstCall, secondCall]);

        expect(first).toEqual([{ from: 0 }]);
        expect(second).toEqual([{ from: 1 }]);
    });

    it('sends the stream id beside the arguments, never inside them', async () => {
        // The router appends its emitter to the argument array; a marker hidden
        // in the payload would make it search inside an opaque list.
        const fake = fakeIpc();
        const bridge = createSourdawBridge(fake.ipc);

        await bridge.stream('provider_gateway_request', ['req-1'], () => undefined);

        expect(fake.invoke).toHaveBeenCalledWith(
            commandChannel('provider_gateway_request'),
            ['req-1'],
            expect.any(String)
        );
    });

    it('releases the correlation on both the resolved and the rejected path', async () => {
        const failing = fakeIpc(() => {
            throw new Error('gateway refused');
        });
        const bridge = createSourdawBridge(failing.ipc);
        const events: unknown[] = [];

        await expect(bridge.stream('provider_gateway_request', [], (payload) => events.push(payload))).rejects.toThrow(
            /gateway refused/u
        );
        const [, , streamId] = failing.invoke.mock.calls[0] ?? [];
        failing.push(STREAM_CHANNEL, streamId, { late: true });

        expect(events).toEqual([]);
    });
});

describe('dialogs and paths', () => {
    it('passes the options through and returns a cancellation as null', async () => {
        const fake = fakeIpc(() => null);
        const bridge = createSourdawBridge(fake.ipc);

        await expect(bridge.dialog.open({ multiple: true })).resolves.toBeNull();
        await expect(bridge.dialog.save({ defaultPath: '/tmp/x.wav' })).resolves.toBeNull();
        expect(fake.invoke).toHaveBeenCalledWith(DIALOG_OPEN_CHANNEL, { multiple: true });
        expect(fake.invoke).toHaveBeenCalledWith(DIALOG_SAVE_CHANNEL, { defaultPath: '/tmp/x.wav' });
    });

    it('returns the picked path, or the list when multiple were asked for', async () => {
        await expect(createSourdawBridge(fakeIpc(() => '/a.wav').ipc).dialog.open()).resolves.toBe('/a.wav');
        await expect(
            createSourdawBridge(fakeIpc(() => ['/a.wav', '/b.wav']).ipc).dialog.open({ multiple: true })
        ).resolves.toEqual(['/a.wav', '/b.wav']);
    });

    it('refuses a dialog result that is neither a path nor a cancellation', async () => {
        const bridge = createSourdawBridge(fakeIpc(() => ({ canceled: false })).ipc);

        await expect(bridge.dialog.open()).rejects.toThrow(/unsupported payload/u);
        await expect(bridge.dialog.save()).rejects.toThrow(/unsupported payload/u);
    });

    it('resolves the message box to nothing rather than to a button index', async () => {
        const fake = fakeIpc(() => ({ response: 0 }));

        await expect(createSourdawBridge(fake.ipc).dialog.message({ message: 'Rendered' })).resolves.toBeUndefined();
        expect(fake.invoke).toHaveBeenCalledWith(DIALOG_MESSAGE_CHANNEL, { message: 'Rendered' });
    });

    it('joins path segments in main, where the host OS separator is known', async () => {
        const fake = fakeIpc(() => '/base/kick.wav');
        const bridge = createSourdawBridge(fake.ipc);

        await expect(bridge.paths.join('/base', 'kick.wav')).resolves.toBe('/base/kick.wav');
        expect(fake.invoke).toHaveBeenCalledWith(PATHS_JOIN_CHANNEL, ['/base', 'kick.wav']);
    });

    it('refuses a path answer that is not a string', async () => {
        const bridge = createSourdawBridge(fakeIpc(() => undefined).ipc);

        await expect(bridge.paths.samplesBase()).rejects.toThrow(/not a string/u);
        await expect(bridge.paths.join('a')).rejects.toThrow(/not a string/u);
    });

    it('asks main for the samples base rather than assuming one', async () => {
        const fake = fakeIpc(() => 'app://sourdaw/samples');

        await expect(createSourdawBridge(fake.ipc).paths.samplesBase()).resolves.toBe('app://sourdaw/samples');
        expect(fake.invoke).toHaveBeenCalledWith(PATHS_SAMPLES_BASE_CHANNEL);
    });
});
