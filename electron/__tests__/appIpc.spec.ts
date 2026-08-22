/**
 * The channels that are not addon commands (REQ-004, REQ-007).
 *
 * The dialogs are where a shell difference becomes data loss rather than an
 * error: Electron answers a cancelled dialog with an object, and every renderer
 * call site here reads a cancellation as `null`. Handing the object through
 * would make "cancel" mean "save to this object", so the translation is pinned
 * for each of the three.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    registerDialogChannels,
    registerPathChannels,
    registerScanCommand,
    registerWindowControlChannels,
    SCAN_COMMAND,
    type NativeDialogs,
    type WindowControlTarget,
} from '../appIpc.js';
import {
    DIALOG_MESSAGE_CHANNEL,
    DIALOG_OPEN_CHANNEL,
    DIALOG_SAVE_CHANNEL,
    PATHS_JOIN_CHANNEL,
    PATHS_SAMPLES_BASE_CHANNEL,
    WINDOW_CLOSE_CHANNEL,
    WINDOW_IS_MAXIMIZED_CHANNEL,
    WINDOW_MINIMIZE_CHANNEL,
    WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
} from '../channels.js';
import { commandChannel } from '../commands.js';

import type { IpcMainLike, SenderFrameCarrier } from '../router.js';
import type { ScanSupervisor } from '../scan.js';
import type { MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from 'electron';

const APP_FRAME: SenderFrameCarrier = { senderFrame: { url: 'app://sourdaw/index.html' } };
const FOREIGN_FRAME: SenderFrameCarrier = { senderFrame: { url: 'https://evil.example/' } };
const isTrustedFrameUrl = (url: string | undefined): boolean => url === APP_FRAME.senderFrame?.url;

type Handler = (event: SenderFrameCarrier, ...args: readonly unknown[]) => unknown;

const collectingIpc = (): { ipcMain: IpcMainLike; handlers: Map<string, Handler> } => {
    const handlers = new Map<string, Handler>();
    return { ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) }, handlers };
};

const cancelledDialogs = (): NativeDialogs => ({
    showOpenDialog: async (_options: OpenDialogOptions) => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async (_options: SaveDialogOptions) => ({ canceled: true, filePath: '' }),
    showMessageBox: async (_options: MessageBoxOptions) => ({ response: 0 }),
});

const dialogHandlers = (answers: Partial<NativeDialogs> = {}): Map<string, Handler> => {
    const { ipcMain, handlers } = collectingIpc();
    registerDialogChannels({ ipcMain, isTrustedFrameUrl, dialogs: { ...cancelledDialogs(), ...answers } });
    return handlers;
};

describe('the scan command', () => {
    const scanHandler = (supervisor: ScanSupervisor): Handler | undefined => {
        const { ipcMain, handlers } = collectingIpc();
        registerScanCommand({ ipcMain, isTrustedFrameUrl, supervisor });
        return handlers.get(commandChannel(SCAN_COMMAND));
    };

    const supervisorSpy = (scan: ScanSupervisor['scan']): ScanSupervisor => ({
        scan,
        isRunning: () => false,
        dispose: () => undefined,
    });

    it('answers on the same channel the router would have used', () => {
        // The renderer must not learn that this one command lives elsewhere: a
        // different channel here is a `scan_plugins` call with no handler.
        expect(scanHandler(supervisorSpy(async () => []))).toBeDefined();
        expect(commandChannel(SCAN_COMMAND)).toBe('sourdaw:invoke:scan_plugins');
    });

    it('forwards the roots to the supervisor and returns its result', async () => {
        const scan = vi.fn(async (_request: { readonly paths: readonly string[] }) => [{ id: 'com.example.synth' }]);

        await expect(scanHandler(supervisorSpy(scan))?.(APP_FRAME, [['/CLAP']])).resolves.toEqual([
            { id: 'com.example.synth' },
        ]);
        expect(scan).toHaveBeenCalledWith({ paths: ['/CLAP'] });
    });

    it('refuses a foreign sender and a malformed root list before forking anything', async () => {
        const scan = vi.fn(async () => []);
        const handler = scanHandler(supervisorSpy(scan));

        // The origin guard throws synchronously, outside the async body;
        // `ipcMain.handle` turns that into a rejection for the renderer.
        expect(() => handler?.(FOREIGN_FRAME, [[]])).toThrow(/not the application/u);
        await expect(handler?.(APP_FRAME, [{ roots: [] }])).rejects.toThrow(/list of paths/u);
        await expect(handler?.(APP_FRAME, [['/a', 7]])).rejects.toThrow(/list of paths/u);
        await expect(handler?.(APP_FRAME, '/a')).rejects.toThrow(/positional array/u);
        expect(scan).not.toHaveBeenCalled();
    });
});

describe('the open dialog', () => {
    it('returns a cancellation as null, never as an Electron result object', async () => {
        await expect(dialogHandlers().get(DIALOG_OPEN_CHANNEL)?.(APP_FRAME, {})).resolves.toBeNull();
    });

    it('returns one path by default and the whole list when multiple was asked for', async () => {
        const handler = dialogHandlers({
            showOpenDialog: async (_options: OpenDialogOptions) => ({
                canceled: false,
                filePaths: ['/a', '/b'],
            }),
        }).get(DIALOG_OPEN_CHANNEL);

        await expect(handler?.(APP_FRAME, {})).resolves.toBe('/a');
        await expect(handler?.(APP_FRAME, { multiple: true })).resolves.toEqual(['/a', '/b']);
    });

    it('reads an empty pick as a cancellation', async () => {
        // Electron can report `canceled: false` with no paths; `filePaths[0]`
        // would then be `undefined` presented to the caller as a chosen file.
        const handler = dialogHandlers({
            showOpenDialog: async (_options: OpenDialogOptions) => ({ canceled: false, filePaths: [] }),
        }).get(DIALOG_OPEN_CHANNEL);

        await expect(handler?.(APP_FRAME, {})).resolves.toBeNull();
    });

    it('asks for a directory only when the caller asked for one', async () => {
        const showOpenDialog = vi.fn(async (_options: OpenDialogOptions) => ({
            canceled: true,
            filePaths: [],
        }));
        const handler = dialogHandlers({ showOpenDialog }).get(DIALOG_OPEN_CHANNEL);

        await handler?.(APP_FRAME, {});
        await handler?.(APP_FRAME, { directory: true, multiple: true });

        expect(showOpenDialog.mock.calls.map(([options]) => options.properties)).toEqual([
            ['openFile'],
            ['openDirectory', 'multiSelections'],
        ]);
    });

    it('passes the filters through and drops the ones that would match nothing', async () => {
        // A filter with no extensions produces a picker that matches no file,
        // which the user reads as a broken app rather than a bad argument.
        const showOpenDialog = vi.fn(async (_options: OpenDialogOptions) => ({
            canceled: true,
            filePaths: [],
        }));
        const handler = dialogHandlers({ showOpenDialog }).get(DIALOG_OPEN_CHANNEL);

        await handler?.(APP_FRAME, {
            title: 'Import audio',
            defaultPath: '/tmp',
            filters: [
                { name: 'Audio', extensions: ['wav', 'aiff'] },
                { name: 'Broken', extensions: [] },
                { extensions: ['mp3'] },
                'nonsense',
            ],
        });

        expect(showOpenDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Import audio',
                defaultPath: '/tmp',
                filters: [{ name: 'Audio', extensions: ['wav', 'aiff'] }],
            })
        );
    });

    it('leaves the filters unset when the caller sent none', async () => {
        const showOpenDialog = vi.fn(async (_options: OpenDialogOptions) => ({
            canceled: true,
            filePaths: [],
        }));
        const handler = dialogHandlers({ showOpenDialog }).get(DIALOG_OPEN_CHANNEL);

        await handler?.(APP_FRAME, {});

        expect(showOpenDialog.mock.calls[0]?.[0].filters).toBeUndefined();
    });
});

describe('the save dialog', () => {
    it('returns the chosen path', async () => {
        const handler = dialogHandlers({
            showSaveDialog: async (_options: SaveDialogOptions) => ({
                canceled: false,
                filePath: '/tmp/mix.wav',
            }),
        }).get(DIALOG_SAVE_CHANNEL);

        await expect(handler?.(APP_FRAME, {})).resolves.toBe('/tmp/mix.wav');
    });

    it('returns null for a cancellation and for an empty path', async () => {
        // The consequence of getting this wrong is a render written to a path
        // that is not a path, after the user pressed Cancel.
        const empty = dialogHandlers({
            showSaveDialog: async (_options: SaveDialogOptions) => ({ canceled: false, filePath: '' }),
        }).get(DIALOG_SAVE_CHANNEL);

        await expect(dialogHandlers().get(DIALOG_SAVE_CHANNEL)?.(APP_FRAME, {})).resolves.toBeNull();
        await expect(empty?.(APP_FRAME, {})).resolves.toBeNull();
    });
});

describe('the message box', () => {
    it('resolves to nothing rather than to a button index', async () => {
        await expect(
            dialogHandlers().get(DIALOG_MESSAGE_CHANNEL)?.(APP_FRAME, { message: 'Rendered' })
        ).resolves.toBeUndefined();
    });

    it('maps the kinds it knows and falls back to info', async () => {
        const showMessageBox = vi.fn(async (_options: MessageBoxOptions) => ({ response: 0 }));
        const handler = dialogHandlers({ showMessageBox }).get(DIALOG_MESSAGE_CHANNEL);

        await handler?.(APP_FRAME, { message: 'a', kind: 'error' });
        await handler?.(APP_FRAME, { message: 'b', kind: 'catastrophe' });
        await handler?.(APP_FRAME, { message: 'c', title: 'Export' });

        expect(showMessageBox.mock.calls.map(([options]) => options)).toEqual([
            { type: 'error', title: 'Sourdaw', message: 'a' },
            { type: 'info', title: 'Sourdaw', message: 'b' },
            { type: 'info', title: 'Export', message: 'c' },
        ]);
    });
});

describe('the path helpers', () => {
    const pathHandlers = (): Map<string, Handler> => {
        const { ipcMain, handlers } = collectingIpc();
        registerPathChannels({
            ipcMain,
            isTrustedFrameUrl,
            samplesBaseUrl: 'app://sourdaw/samples',
            join: (...segments) => segments.join('/'),
        });
        return handlers;
    };

    it('answers with the samples base and joins segments in main', () => {
        const handlers = pathHandlers();

        expect(handlers.get(PATHS_SAMPLES_BASE_CHANNEL)?.(APP_FRAME)).toBe('app://sourdaw/samples');
        expect(handlers.get(PATHS_JOIN_CHANNEL)?.(APP_FRAME, ['/base', 'kick.wav'])).toBe('/base/kick.wav');
    });

    it('refuses segments that are not strings', () => {
        const handlers = pathHandlers();

        expect(() => handlers.get(PATHS_JOIN_CHANNEL)?.(APP_FRAME, ['/base', 7])).toThrow(/string segments/u);
        expect(() => handlers.get(PATHS_JOIN_CHANNEL)?.(APP_FRAME, '/base')).toThrow(/string segments/u);
    });
});

describe('the origin guard on every non-command channel', () => {
    it('refuses a foreign frame on each one', () => {
        const { ipcMain, handlers } = collectingIpc();
        registerDialogChannels({ ipcMain, isTrustedFrameUrl, dialogs: cancelledDialogs() });
        registerPathChannels({
            ipcMain,
            isTrustedFrameUrl,
            samplesBaseUrl: 'app://sourdaw/samples',
            join: (...segments) => segments.join('/'),
        });

        expect([...handlers.keys()].sort()).toEqual(
            [
                DIALOG_MESSAGE_CHANNEL,
                DIALOG_OPEN_CHANNEL,
                DIALOG_SAVE_CHANNEL,
                PATHS_JOIN_CHANNEL,
                PATHS_SAMPLES_BASE_CHANNEL,
            ].sort()
        );
        for (const handler of handlers.values()) {
            expect(() => handler(FOREIGN_FRAME, {})).toThrow(/not the application/u);
        }
    });
});

describe('the window controls', () => {
    const fakeWindow = (initiallyMaximized = false): WindowControlTarget => {
        // Stateful like the real BrowserWindow: maximize/unmaximize move the
        // state isMaximized then reports.
        let maximized = initiallyMaximized;
        return {
            minimize: vi.fn(),
            maximize: vi.fn(() => {
                maximized = true;
            }),
            unmaximize: vi.fn(() => {
                maximized = false;
            }),
            isMaximized: vi.fn(() => maximized),
            close: vi.fn(),
        };
    };

    const windowControlHandlers = (
        windowForSender: (sender: unknown) => WindowControlTarget | null
    ): Map<string, Handler> => {
        const { ipcMain, handlers } = collectingIpc();
        registerWindowControlChannels({ ipcMain, isTrustedFrameUrl, windowForSender });
        return handlers;
    };

    it('resolves the calling window from the sender, never a captured one', async () => {
        // Crash recovery replaces the window; a captured reference would keep
        // driving the destroyed one, so the resolver runs on every call.
        const window = fakeWindow();
        const windowForSender = vi.fn((_sender: unknown) => window);
        const handlers = windowControlHandlers(windowForSender);
        const frame = { ...APP_FRAME, sender: 'web-contents' };

        await handlers.get(WINDOW_MINIMIZE_CHANNEL)?.(frame);

        expect(windowForSender).toHaveBeenCalledWith('web-contents');
        expect(window.minimize).toHaveBeenCalledTimes(1);
    });

    it('refuses a foreign frame on all four channels before touching a window', () => {
        const windowForSender = vi.fn((_sender: unknown) => fakeWindow());
        const handlers = windowControlHandlers(windowForSender);

        expect([...handlers.keys()].sort()).toEqual(
            [
                WINDOW_CLOSE_CHANNEL,
                WINDOW_IS_MAXIMIZED_CHANNEL,
                WINDOW_MINIMIZE_CHANNEL,
                WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
            ].sort()
        );
        for (const handler of handlers.values()) {
            expect(() => handler(FOREIGN_FRAME)).toThrow(/not the application/u);
        }
        expect(windowForSender).not.toHaveBeenCalled();
    });

    it('closes the calling window', async () => {
        const window = fakeWindow();
        const handlers = windowControlHandlers(() => window);

        await handlers.get(WINDOW_CLOSE_CHANNEL)?.(APP_FRAME);

        expect(window.close).toHaveBeenCalledTimes(1);
    });

    it('toggles to the opposite state and answers with the resulting one', () => {
        const restored = fakeWindow(true);
        const maximized = fakeWindow(false);
        const handlers = windowControlHandlers(() => restored);

        // The handlers are synchronous; `ipcMain.handle` lifts the return into
        // the invoke promise at the Electron boundary.
        expect(handlers.get(WINDOW_TOGGLE_MAXIMIZE_CHANNEL)?.(APP_FRAME)).toBe(false);
        expect(restored.unmaximize).toHaveBeenCalledTimes(1);
        expect(restored.maximize).not.toHaveBeenCalled();

        const other = windowControlHandlers(() => maximized);
        expect(other.get(WINDOW_TOGGLE_MAXIMIZE_CHANNEL)?.(APP_FRAME)).toBe(true);
        expect(maximized.maximize).toHaveBeenCalledTimes(1);
        expect(maximized.unmaximize).not.toHaveBeenCalled();
    });

    it('answers is-maximized with the resolved window state', () => {
        expect(windowControlHandlers(() => fakeWindow(true)).get(WINDOW_IS_MAXIMIZED_CHANNEL)?.(APP_FRAME)).toBe(true);
        expect(windowControlHandlers(() => fakeWindow(false)).get(WINDOW_IS_MAXIMIZED_CHANNEL)?.(APP_FRAME)).toBe(
            false
        );
    });

    it('no-ops a sender whose window is gone instead of throwing into a dying renderer', () => {
        const handlers = windowControlHandlers(() => null);

        expect(handlers.get(WINDOW_MINIMIZE_CHANNEL)?.(APP_FRAME)).toBeUndefined();
        expect(handlers.get(WINDOW_CLOSE_CHANNEL)?.(APP_FRAME)).toBeUndefined();
        expect(handlers.get(WINDOW_TOGGLE_MAXIMIZE_CHANNEL)?.(APP_FRAME)).toBe(false);
        expect(handlers.get(WINDOW_IS_MAXIMIZED_CHANNEL)?.(APP_FRAME)).toBe(false);
    });
});
