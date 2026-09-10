/**
 * The packaged renderer's security boundary, as one entry point (AC-057 of
 * #2372).
 *
 * Pins the cross-file invariants no single module spec already holds on its
 * own: that the plugin-runtime command allow-list never widens into a
 * privileged command, that every privileged command (not just one) is behind
 * the trusted-sender gate, that a plugin editor window is built as a bare
 * native window with no renderer bridge, that a renderer-authored project
 * title and recent-project name cannot reach a native menu label, window
 * title, or close-dialog message without bound, and that the stream cap
 * actually tracks the renderer figure it claims to match rather than a
 * duplicated literal.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import * as shellChannels from '../channels.js';
import { addonMethodName, commandChannel, EXPOSED_COMMANDS } from '../commands.js';
import { STREAM_QUEUE_CAPACITY } from '../events.js';
import { forwardNativeEvent } from '../nativeEventRouter.js';
import { boundShellLabel, createNativeMenuProjectStateController } from '../nativeMenuProjectState.js';
import { PLUGIN_RUNTIME_COMMANDS } from '../pluginCommandAdmission.js';
import { createEditorWindow } from '../pluginEditorWindow.js';
import { registerCommandRouter } from '../router.js';

import type { NativeHost } from '../native.js';
import type { EditorWindowOptions } from '../pluginGui.js';
import type { CommandStream, IpcMainLike, SenderFrameCarrier } from '../router.js';

// `pluginEditorWindow.ts`'s only Electron import is the `BaseWindow`
// constructor, so mocking `electron` here (unlike `main.ts`'s whole native
// surface) needs no more than the two window constructors the case below
// tells apart. `vi.mock` is hoisted above the imports above, so
// `createEditorWindow` resolves against this mock, not the real module.
const { baseWindowCalls, browserWindowCalls } = vi.hoisted(() => ({
    baseWindowCalls: [] as Record<string, unknown>[],
    browserWindowCalls: [] as Record<string, unknown>[],
}));

vi.mock('electron', () => ({
    BaseWindow: class MockBaseWindow {
        constructor(options: Record<string, unknown>) {
            baseWindowCalls.push(options);
        }
    },
    BrowserWindow: class MockBrowserWindow {
        constructor(options: Record<string, unknown>) {
            browserWindowCalls.push(options);
        }
    },
}));

describe('the command allow-lists do not overlap into privilege expansion', () => {
    /** Reaches file bytes, a directory listing, or provider gateway credentials — never a surface a plugin-runtime command may share. */
    const PRIVILEGED_COMMAND_FAMILIES: readonly string[] = [
        'open_provider_gateway_session',
        'provider_gateway_request',
        'cancel_provider_gateway_request',
        'close_provider_gateway_session',
        'read_file_bytes',
        'write_file_bytes',
        'list_directory',
        'load_cached_whisper_model',
    ];

    it('keeps PLUGIN_RUNTIME_COMMANDS inside the exposed command surface', () => {
        const exposed = new Set(EXPOSED_COMMANDS);
        for (const command of PLUGIN_RUNTIME_COMMANDS) {
            expect(exposed.has(command)).toBe(true);
        }
    });

    it('keeps PLUGIN_RUNTIME_COMMANDS out of the privileged command families', () => {
        for (const command of PLUGIN_RUNTIME_COMMANDS) {
            expect(PRIVILEGED_COMMAND_FAMILIES.includes(command)).toBe(false);
            expect(command.startsWith('collab_')).toBe(false);
        }
    });

    it('gives no named shell channel the same wire name as an exposed command channel', () => {
        // Every runtime export of `channels.ts` is a channel string; its type
        // exports do not survive to runtime, so this needs no hand-kept list.
        // Widened to `unknown` first: the module's own inferred literal-union
        // type would make a `value is string` guard narrower than its input.
        const shellChannelValues: readonly unknown[] = Object.values(shellChannels);
        const namedChannels = shellChannelValues.filter((value): value is string => typeof value === 'string');
        const commandChannels = new Set(EXPOSED_COMMANDS.map(commandChannel));

        expect(namedChannels.length).toBeGreaterThan(0);
        for (const channel of namedChannels) {
            expect(commandChannels.has(channel)).toBe(false);
        }
    });
});

describe('privileged commands reach the addon only behind the trusted-sender check', () => {
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

    /** A router registered for exactly one privileged command, with a stubbed addon method. */
    const routerFor = (
        command: string,
        implementation: (...args: readonly unknown[]) => unknown
    ): Handler | undefined => {
        const method = addonMethodName(command);
        const refuse = (name: string) => (): never => {
            throw new Error(`unexpected ${name} call from a privileged-command test`);
        };
        const host = {
            shutdown: () => undefined,
            grantPath: refuse('grantPath'),
            startDictation: refuse('startDictation'),
            stopDictation: refuse('stopDictation'),
            cancelDictation: refuse('cancelDictation'),
            [method]: implementation,
        } as unknown as NativeHost;
        const { ipcMain, handlers } = collectingIpc();

        registerCommandRouter({
            ipcMain,
            native: () => host,
            isTrustedFrameUrl: (url) => url === APP_FRAME.senderFrame?.url,
            createStream: nullStream,
            commands: [command],
        });

        return handlers.get(commandChannel(command));
    };

    /** Every command that reaches file bytes, a directory listing, provider gateway credentials, a collaboration document, or the cached model store. */
    const PRIVILEGED_COMMANDS = [
        'open_provider_gateway_session',
        'provider_gateway_request',
        'cancel_provider_gateway_request',
        'close_provider_gateway_session',
        'read_file_bytes',
        'write_file_bytes',
        'list_directory',
        'load_cached_whisper_model',
        'collab_apply_change',
        'collab_create_project',
        'collab_get_document_state',
        'collab_load_bundle',
        'collab_merge_bundle',
        'collab_save_bundle',
    ] as const;

    it.each(PRIVILEGED_COMMANDS)('refuses %s from a foreign frame before the addon runs', (command) => {
        expect(EXPOSED_COMMANDS).toContain(command);
        const implementation = vi.fn();
        const handler = routerFor(command, implementation);

        expect(() => handler?.(FOREIGN_FRAME, [])).toThrow(
            `${command} rejected: the sender frame is not the application`
        );
        expect(implementation).not.toHaveBeenCalled();
    });

    it.each(PRIVILEGED_COMMANDS)(
        'reaches the addon exactly once for %s from the application frame',
        async (command) => {
            expect(EXPOSED_COMMANDS).toContain(command);
            const implementation = vi.fn(() => 'ok');
            const handler = routerFor(command, implementation);

            await handler?.(APP_FRAME, []);

            expect(implementation).toHaveBeenCalledTimes(1);
        }
    );

    it('refuses a non-array argument for provider_gateway_request specifically', async () => {
        const handler = routerFor('provider_gateway_request', vi.fn());

        await expect(handler?.(APP_FRAME, { requestId: 'x' })).rejects.toThrow(
            'Command arguments must be a positional array'
        );
    });
});

describe('plugin GUI windows expose no renderer bridge', () => {
    it('builds a plugin editor as a hidden BaseWindow and never a BrowserWindow', () => {
        const options: EditorWindowOptions = { title: 'Editor', parent: undefined, alwaysOnTop: true };

        createEditorWindow(options);

        expect(baseWindowCalls).toHaveLength(1);
        expect(baseWindowCalls[0]).toMatchObject({ show: false });
        expect(browserWindowCalls).toHaveLength(0);
    });
});

describe('untrusted project strings never reach a privileged context unbounded', () => {
    const controlOne = String.fromCharCode(1);
    const lineFeed = String.fromCharCode(10);
    /**
     * A control character at the first retained code point and another about
     * a hundred in, both inside the 256-code-point prefix `boundShellLabel`
     * keeps, followed by a long tail so truncation is exercised in the same
     * fixture rather than only past the cut where the filter never runs.
     */
    const hostileLabel = `${controlOne}${'a'.repeat(99)}${lineFeed}${'b'.repeat(9800)}`;

    it('bounds a hostile label to 256 code points with no control characters', () => {
        const bounded = boundShellLabel(hostileLabel);

        expect([...bounded].length).toBeLessThanOrEqual(256);
        expect(bounded).not.toContain(controlOne);
        expect(bounded).not.toContain(lineFeed);
    });

    it('bounds a hostile project title before it reaches the window title and the close dialog', () => {
        const window = { isDestroyed: () => false, setTitle: vi.fn(), setDocumentEdited: vi.fn() };
        const updateCloseState = vi.fn();
        const controller = createNativeMenuProjectStateController({
            updateCloseState,
            getWindow: () => window,
            rebuildApplicationMenu: vi.fn(),
        });

        controller.apply({
            title: hostileLabel,
            dirty: false,
            durabilityPending: false,
            projectKey: 'song',
            revision: '1',
            recentProjects: [],
        });

        const boundedLabel = boundShellLabel(hostileLabel);
        const [setTitleArgument] = window.setTitle.mock.calls[0] as [string];
        const [[capturedState]] = updateCloseState.mock.calls as [[{ readonly title: string }]];

        expect(setTitleArgument).toBe(`${boundedLabel} — Sourdaw`);
        expect(setTitleArgument).not.toContain(controlOne);
        expect(setTitleArgument).not.toContain(lineFeed);
        expect(capturedState.title).toBe(boundedLabel);
        expect([...capturedState.title].length).toBeLessThanOrEqual(256);
        expect(capturedState.title).not.toContain(controlOne);
        expect(capturedState.title).not.toContain(lineFeed);
    });

    it('passes an ordinary project title through unchanged to the window title and the close dialog', () => {
        const window = { isDestroyed: () => false, setTitle: vi.fn(), setDocumentEdited: vi.fn() };
        const updateCloseState = vi.fn();
        const controller = createNativeMenuProjectStateController({
            updateCloseState,
            getWindow: () => window,
            rebuildApplicationMenu: vi.fn(),
        });

        controller.apply({
            title: 'Final mix',
            dirty: false,
            durabilityPending: false,
            projectKey: 'song',
            revision: '1',
            recentProjects: [],
        });

        expect(window.setTitle).toHaveBeenCalledWith('Final mix — Sourdaw');
        const [[capturedState]] = updateCloseState.mock.calls as [[{ readonly title: string }]];
        expect(capturedState.title).toBe('Final mix');
    });

    it('bounds a hostile recent-project name before it reaches the menu builder', () => {
        const rebuildApplicationMenu = vi.fn();
        const controller = createNativeMenuProjectStateController({
            updateCloseState: () => undefined,
            getWindow: () => undefined,
            rebuildApplicationMenu,
        });

        controller.apply({
            title: 'Song',
            dirty: false,
            durabilityPending: false,
            projectKey: 'song',
            revision: '1',
            recentProjects: [{ key: 'k', name: hostileLabel }],
        });

        expect(rebuildApplicationMenu).toHaveBeenCalledTimes(1);
        const [[recentProjects]] = rebuildApplicationMenu.mock.calls as [
            [readonly { readonly key: string; readonly name: string }[]],
        ];
        const label = recentProjects[0]?.name ?? '';

        expect(label).toBe(boundShellLabel(hostileLabel));
        expect([...label].length).toBeLessThanOrEqual(256);
        expect(label).not.toContain(controlOne);
        expect(label).not.toContain(lineFeed);
    });
});

describe('the Rust to renderer event bound matches the renderer figure it claims to', () => {
    /** The only streaming caller today; `STREAM_QUEUE_CAPACITY` is sized to never queue past what it already refuses. */
    const PROVIDER_GATEWAY_PATH = 'src/modules/AiRuntime/repositories/providerGateway.ts';

    const rendererMaxProviderEvents = (): number => {
        // The renderer cannot be imported from the electron test tree
        // (`electron/tsconfig.json` carries no path alias into `src/`), so its
        // own constant is read as text instead of hardcoding a duplicate
        // literal that could silently drift from it.
        const source = readFileSync(resolve(PROVIDER_GATEWAY_PATH), 'utf8');
        const match = /const MAX_PROVIDER_EVENTS = (\d+);/u.exec(source);
        if (match?.[1] === undefined) {
            throw new Error(`MAX_PROVIDER_EVENTS not found in ${PROVIDER_GATEWAY_PATH}`);
        }
        return Number(match[1]);
    };

    it('keeps STREAM_QUEUE_CAPACITY equal to the renderer provider gateway cap', () => {
        expect(STREAM_QUEUE_CAPACITY).toBe(rendererMaxProviderEvents());
    });
});

describe('dictation terminals never route through the generic event forwarder', () => {
    it('keeps a dictation error, not only a dictation result, out of the generic renderer event channel', () => {
        const events = { emit: vi.fn() };
        const target = { isDestroyed: () => false, send: vi.fn() };

        forwardNativeEvent('dictation-error', { session_id: 'voice-1', message: 'mic denied' }, events, () => target);

        expect(events.emit).not.toHaveBeenCalled();
        expect(target.send).toHaveBeenCalledWith(shellChannels.VOICE_DICTATION_TERMINAL_CHANNEL, 'dictation-error', {
            session_id: 'voice-1',
            message: 'mic denied',
        });
        expect(target.send).not.toHaveBeenCalledWith(shellChannels.EVENT_CHANNEL, expect.anything(), expect.anything());
    });
});
