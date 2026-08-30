/**
 * Electron main process (REQ-001, REQ-004, REQ-006, REQ-007, REQ-012).
 *
 * The shell hosts the unmodified web build and now also carries the native
 * surface: a preload bridge, one `ipcMain` handler per exposed command backed
 * by the `sourdaw-native` addon, the event path, plugin scanning in its own
 * process, and an explicit quit cascade.
 *
 * The renderer's desktop seam (`src/utils/desktopBridge.ts`) answers from the
 * `window.sourdaw` bridge this shell's preload publishes, so under Electron
 * the renderer takes its native paths through the surface below.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import {
    app,
    BaseWindow,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    screen,
    session,
    shell,
    utilityProcess,
} from 'electron';

import {
    registerDialogChannels,
    registerPathChannels,
    registerScanCommand,
    registerNativeMenuChannels,
    registerWindowControlChannels,
    SCAN_COMMAND,
} from './appIpc.js';
import { createApplicationMenuTemplate, type NativeMenuIntent } from './applicationMenu.js';
import {
    EVENT_CHANNEL,
    NATIVE_MENU_ACTION_CHANNEL,
    STREAM_CHANNEL,
    WINDOW_MAXIMIZED_CHANGED_CHANNEL,
} from './channels.js';
import { EXPOSED_COMMANDS } from './commands.js';
import { createCommandStream, createEventForwarder } from './events.js';
import { bindMainWindowOwnerTeardown, destroyCrashedMainWindow } from './mainWindowTeardown.js';
import { loadNativeAddon, NATIVE_ADDON_PATH_ENV, resolveNativeAddonPath, type NativeHost } from './native.js';
import { forwardNativeEvent } from './nativeEventRouter.js';
import { createNativeMenuActionDispatcher } from './nativeMenuActionDispatcher.js';
import { createNativeMenuProjectStateController } from './nativeMenuProjectState.js';
import { createPluginCommandAdmission } from './pluginCommandAdmission.js';
import {
    registerPluginWindowHost,
    type EditorWindow,
    type EditorWindowOptions,
    type PluginWindowHost,
} from './pluginGui.js';
import { APP_ENTRY_URL, APP_ORIGIN, handleAppProtocol, registerAppScheme, resolveContentRoots } from './protocol.js';
import { createRendererSessionLifecycle } from './rendererSessionLifecycle.js';
import { registerCommandRouter } from './router.js';
import { createScanSupervisor, type ScanSupervisor } from './scan.js';
import { applyPermissionPolicy, decideWindowOpen, isNavigationAllowed, trustedFrameGuard } from './security.js';
import { createQuitHandler, runBeforeQuitCascade, type ShutdownOutcome } from './shutdown.js';
import { systemTimers } from './timers.js';
import { registerVoiceDictation } from './voiceDictation.js';
import { getWindowChromeOptions } from './windowChrome.js';
import { createWindowCloseCoordinator } from './windowCloseCoordinator.js';

import type { WebContents } from 'electron';

// Logging must never crash the shell. When stdout or stderr is a closed pipe
// — a packaged app whose parent went away — every console write raises EPIPE,
// and an unhandled stream error becomes an uncaughtException dialog per write.
process.stdout.on('error', () => undefined);
process.stderr.on('error', () => undefined);

// Before anything that can await. Chromium builds its privileged-scheme table
// once, at `ready`; the ESM main entry resumes after `ready` at the first await,
// and a scheme registered then is silently an ordinary opaque scheme.
registerAppScheme();

// No `--enable-features=WebAudioConfigurableRenderQuantum`. Nothing in the
// renderer passes `renderSizeHint`, so the flag changes no behaviour today, and
// the Chromium implementation carries an open renderer-memory-safety bug
// (crbug 485292589). Re-add it when the engine actually requests a quantum, or
// drop the idea entirely once Electron ships a Chromium where it is default-on.

/** Set by `pnpm desktop:dev`. Turns on renderer log forwarding and the isolation probe. */
const isDevShell = process.env.SOURDAW_DESKTOP_DEV === '1';
/** Optional: load the Vite dev server instead of the built `dist/`. It already sends COOP/COEP. */
const devServerUrl = isDevShell ? process.env.SOURDAW_DEV_SERVER_URL : undefined;
/** Verification aid: quit after the isolation probe instead of waiting for a human. */
const probeExitMs = Number.parseInt(process.env.SOURDAW_DESKTOP_PROBE_EXIT_MS ?? '', 10);

const entryUrl = devServerUrl ?? APP_ENTRY_URL;

/**
 * The origins the shell will stay on. Anything else is off-app: a link in a
 * chat panel, a redirect from a model provider, a crafted `location =`. Those
 * belong in the user's browser, never in a window that holds the session.
 */
const allowedOrigins = (): readonly string[] => {
    const origins = [APP_ORIGIN];
    if (devServerUrl !== undefined) {
        origins.push(new URL(devServerUrl).origin);
    }
    return origins;
};

const isAllowedNavigation = (url: string): boolean => isNavigationAllowed(allowedOrigins(), url);

const isAllowedFrameUrl = trustedFrameGuard(allowedOrigins);

let mainWindow: BrowserWindow | undefined;
let pluginWindowHost: PluginWindowHost | undefined;
let destroyMainWindowAfterEditorsDetach: (() => Promise<void>) | undefined;
const rendererSessionLifecycle = createRendererSessionLifecycle();

const createAndActivateWindow = (): BrowserWindow => {
    rendererSessionLifecycle.startWindow();
    const window = createWindow();
    mainWindow = window;
    return window;
};

const nativeMenuActionDispatcher = createNativeMenuActionDispatcher({
    isMac: process.platform === 'darwin',
    actionChannel: NATIVE_MENU_ACTION_CHANNEL,
    getWindow: () => mainWindow,
    createWindow: createAndActivateWindow,
});

const nativeMenuAction = (intent: NativeMenuIntent): void => {
    nativeMenuActionDispatcher.dispatch(intent);
};

const rebuildMacApplicationMenu = (
    recentProjects: readonly { readonly key: string; readonly name: string }[] = []
): void => {
    if (process.platform !== 'darwin') {
        return;
    }
    Menu.setApplicationMenu(
        Menu.buildFromTemplate(
            createApplicationMenuTemplate({ appName: 'Sourdaw', send: nativeMenuAction, recentProjects })
        )
    );
};

const windowCloseCoordinator = createWindowCloseCoordinator({
    ask: async (title) => {
        const window = mainWindow;
        if (window === undefined || window.isDestroyed()) {
            return 'cancel';
        }
        const answer = await dialog.showMessageBox(window, {
            type: 'warning',
            buttons: ['Save', 'Don’t Save', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            message: `Do you want to save the changes you made to “${title}”?`,
            detail: 'Your changes will be lost if you do not save them.',
        });
        if (answer.response === 0) {
            return 'save';
        }
        if (answer.response === 1) {
            return 'discard';
        }
        return 'cancel';
    },
    send: (operation, requestId) =>
        nativeMenuAction({ action: operation === 'save' ? 'project:save' : 'project:discard', requestId }),
});

const nativeMenuProjectStateController = createNativeMenuProjectStateController({
    updateCloseState: (state) => windowCloseCoordinator.updateProject(state),
    getWindow: () => mainWindow,
    rebuildApplicationMenu: rebuildMacApplicationMenu,
});

const quiesceApprovedMainWindow = async (): Promise<void> => {
    const window = mainWindow;
    if (window === undefined) {
        return;
    }
    try {
        if (!window.isDestroyed()) {
            if (destroyMainWindowAfterEditorsDetach !== undefined) {
                await destroyMainWindowAfterEditorsDetach();
            } else {
                window.hide();
                window.destroy();
            }
        }
    } catch (error) {
        console.error('[shell] failed to quiesce the renderer before shutdown:', error);
        try {
            if (!window.isDestroyed()) {
                window.hide();
                window.destroy();
            }
        } catch (destroyError) {
            console.error('[shell] failed to force renderer teardown before shutdown:', destroyError);
        }
    } finally {
        if (mainWindow === window) {
            mainWindow = undefined;
        }
    }
};

const attachWebContentsPolicy = (window: BrowserWindow): void => {
    window.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedNavigation(url)) {
            event.preventDefault();
            console.warn(`[shell] blocked navigation to ${url}`);
        }
    });

    // A DAW window is the session. Nothing gets to open a second one, and an
    // external link goes to the user's browser rather than an Electron window
    // that would inherit this origin.
    window.webContents.setWindowOpenHandler(({ url }) => {
        const decision = decideWindowOpen(url);
        if (decision.legalDocument !== undefined) {
            const legalRoot = app.isPackaged
                ? join(process.resourcesPath, 'legal')
                : resolve(dirname(import.meta.dirname), '..', 'public', 'legal');
            void shell.openPath(join(legalRoot, decision.legalDocument)).then((error) => {
                if (error !== '') {
                    console.warn(`[shell] failed to open legal document: ${error}`);
                }
            });
        } else if (decision.openExternally) {
            void shell.openExternal(url);
        } else {
            console.warn(`[shell] blocked window-open target: ${url}`);
        }
        return { action: decision.action };
    });

    if (isDevShell) {
        window.webContents.on('console-message', (details) => {
            console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
        });
        window.webContents.on('did-finish-load', () => {
            void runIsolationProbe(window);
        });
    }
};

const createWindow = (): BrowserWindow => {
    windowCloseCoordinator.resetForWindow();
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 600,
        title: 'Sourdaw',
        backgroundColor: '#0a0a0a',
        show: false,
        ...getWindowChromeOptions(process.platform),
        webPreferences: {
            // Stated rather than inherited: these three are Electron's defaults
            // today, and each one is load-bearing. A future default change, or
            // a copied config, must not quietly hand the renderer Node.
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            // The audio graph, the transport clock and the meters keep running
            // when the window is behind another app. Chromium's background
            // timer throttling would stall them — unacceptable while recording.
            backgroundThrottling: false,
            // The bundle from `scripts/buildElectronPreload.ts`, not `tsc`'s
            // `preload.js`. A sandboxed preload is CommonJS and its `require`
            // is a polyfill that resolves nothing relative, so it has to arrive
            // as one self-contained file.
            preload: join(import.meta.dirname, 'preload.cjs'),
        },
    });

    window.once('ready-to-show', () => window.show());
    // The frameless chrome's maximize button mirrors the native state; each
    // window reports its own transitions so a recreated window is wired fresh.
    window.on('maximize', () => window.webContents.send(WINDOW_MAXIMIZED_CHANGED_CHANNEL, true));
    window.on('unmaximize', () => window.webContents.send(WINDOW_MAXIMIZED_CHANGED_CHANNEL, false));
    window.on('close', (event) => {
        if (windowCloseCoordinator.permitsClose()) {
            rendererSessionLifecycle.approveTeardown();
            windowCloseCoordinator.markClosing();
            return;
        }
        event.preventDefault();
        void windowCloseCoordinator.requestClose().then((approved) => {
            if (approved && !window.isDestroyed()) {
                window.close();
            }
        });
    });
    attachWebContentsPolicy(window);
    void window.loadURL(entryUrl);
    destroyMainWindowAfterEditorsDetach = bindMainWindowOwnerTeardown(window, pluginWindowHost, () =>
        windowCloseCoordinator.permitsClose()
    );
    return window;
};

/**
 * Dev-only proof that the origin is cross-origin isolated, carrying the policy
 * headers, and resolving the renderer's root-absolute asset URLs.
 *
 * Read from the renderer, not from the handler that wrote them: a header the
 * browser rejected or a policy Chromium refused to apply would still look
 * correct on the sending side. The asset probes matter because the web build
 * addresses its wasm and its worklet processors as `/wasm/...` and
 * `/audio/worklets/...`, which only resolve on an origin with a path root —
 * under `file://` they would 404 and the audio graph would never start.
 *
 * A 200 is not enough for either asset class. `WebAssembly` streaming refuses
 * anything whose Content-Type is not exactly `application/wasm`, and
 * `audioWorklet.addModule` refuses a response that is not a JavaScript MIME
 * type — a protocol handler that served both as `text/plain` would pass a
 * status check and still leave the DAW with no DSP. So the probe asserts the
 * types and then actually performs both loads, which is the only check that
 * cannot pass while blind to the thing it names.
 */
const runIsolationProbe = async (window: BrowserWindow): Promise<void> => {
    const probe = `(async () => {
        const response = await fetch(location.href, { cache: 'no-store' });
        const probeAsset = async (path) => {
            try {
                const assetResponse = await fetch(path, { cache: 'no-store' });
                return {
                    status: assetResponse.status,
                    contentType: assetResponse.headers.get('content-type'),
                };
            } catch (error) {
                return { status: String(error), contentType: null };
            }
        };
        const compileWasm = async (path) => {
            try {
                await WebAssembly.compileStreaming(fetch(path, { cache: 'no-store' }));
                return 'compiled';
            } catch (error) {
                return String(error);
            }
        };
        const addWorklet = async (path) => {
            let context;
            try {
                context = new OfflineAudioContext({ length: 128, sampleRate: 48000 });
                await context.audioWorklet.addModule(path);
                return 'added';
            } catch (error) {
                return String(error);
            }
        };
        return JSON.stringify({
            url: location.href,
            status: response.status,
            'cross-origin-opener-policy': response.headers.get('cross-origin-opener-policy'),
            'cross-origin-embedder-policy': response.headers.get('cross-origin-embedder-policy'),
            'cross-origin-resource-policy': response.headers.get('cross-origin-resource-policy'),
            'content-security-policy': response.headers.get('content-security-policy'),
            crossOriginIsolated: globalThis.crossOriginIsolated,
            sharedArrayBuffer: typeof SharedArrayBuffer,
            assets: {
                '/wasm/manifest.json': await probeAsset('/wasm/manifest.json'),
                '/wasm/daw-dsp/daw_dsp_bg.wasm': await probeAsset('/wasm/daw-dsp/daw_dsp_bg.wasm'),
                '/audio/worklets/sidechain-compressor-processor.js': await probeAsset('/audio/worklets/sidechain-compressor-processor.js'),
            },
            loads: {
                'WebAssembly.compileStreaming': await compileWasm('/wasm/daw-dsp/daw_dsp_bg.wasm'),
                'audioWorklet.addModule': await addWorklet('/audio/worklets/sidechain-compressor-processor.js'),
            },
        });
    })()`;

    try {
        const result: unknown = await window.webContents.executeJavaScript(probe, true);
        console.log(`[shell] isolation-probe ${String(result)}`);
    } catch (error) {
        console.error(`[shell] isolation-probe failed: ${String(error)}`);
    }

    if (Number.isFinite(probeExitMs) && probeExitMs > 0) {
        setTimeout(() => {
            console.log('[shell] probe-exit reached, quitting');
            app.quit();
        }, probeExitMs);
    }
};

/**
 * The repository root when running unpackaged, matching `resolveContentRoots`:
 * this file compiles into `electron/out/`, so the root is two levels up.
 */
const repoRoot = (): string => resolve(dirname(import.meta.dirname), '..');

const nativeAddonPath = (): string =>
    resolveNativeAddonPath({
        env: process.env,
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        repoRoot: repoRoot(),
    });

/**
 * The live renderer, for the event and stream paths.
 *
 * Read through a function rather than captured, because the window is replaced
 * on a renderer crash. A captured `webContents` would keep pushing events at
 * the dead one, so a recovered session would come back with no MIDI, no
 * dictation and no plugin latency updates — silently, since every one of those
 * is fire and forget.
 */
const rendererTarget = (): BrowserWindow['webContents'] | undefined =>
    mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined;

let nativeHost: NativeHost | undefined;
let scanSupervisor: ScanSupervisor | undefined;
const pluginCommandAdmission = createPluginCommandAdmission();

/**
 * The plugin-scan supervisor, over a real `utilityProcess`.
 *
 * The adapter is here rather than in `scan.ts` so that the supervisor's logic —
 * single-flight, timeout, crash-is-a-failed-scan, next-scan-works — is testable
 * without an Electron process, and this is the only code that has to know what
 * Electron calls those two signals.
 */
const createUtilityScanSupervisor = (addonPath: string): ScanSupervisor =>
    createScanSupervisor({
        timers: systemTimers,
        fork: () => {
            const child = utilityProcess.fork(join(import.meta.dirname, 'scanWorker.js'), [], {
                // The addon path is passed rather than re-derived: the utility
                // process has no `app` and cannot ask whether this is a
                // packaged build.
                env: { ...process.env, [NATIVE_ADDON_PATH_ENV]: addonPath },
                stdio: 'ignore',
            });
            return {
                postMessage: (message) => child.postMessage(message),
                onMessage: (listener) => {
                    child.on('message', listener);
                },
                onExit: (listener) => {
                    child.on('exit', listener);
                },
                kill: () => {
                    child.kill();
                },
            };
        },
    });

/**
 * The scale of the display a plugin editor window is on.
 *
 * The editor's own window when there is one, because an editor dragged to a
 * display of a different density has to be told; the DAW window otherwise,
 * which is where an editor is about to open, since an editor sized against the
 * primary display's scale is the wrong size on every other one.
 */
const editorWindowScaleFactor = (editor?: EditorWindow): number => {
    const daw = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const bounds = editor?.getBounds() ?? daw?.getBounds();
    return bounds === undefined
        ? screen.getPrimaryDisplay().scaleFactor
        : screen.getDisplayMatching(bounds).scaleFactor;
};

/**
 * A bare native window for one plugin editor: no webcontents, hidden until the
 * addon has run the GUI lifecycle and knows the plugin's preferred size, and
 * `resizable: false` until the plugin has said whether its editor accepts a
 * size the host chose — an answer that does not exist until that lifecycle has
 * run. 800×600 is only the pre-lifecycle placeholder the addon immediately
 * resizes.
 */
const createEditorWindow = (options: EditorWindowOptions): EditorWindow =>
    new BaseWindow({
        width: 800,
        height: 600,
        title: options.title,
        show: false,
        resizable: false,
        alwaysOnTop: options.alwaysOnTop,
        ...(options.parent === undefined ? {} : { parent: options.parent }),
    });

/**
 * Build the native host and wire everything that depends on it.
 *
 * A missing or unloadable addon is reported and survived rather than fatal. The
 * renderer runs its browser path today, so a shell with no addon is the shell
 * that shipped in the previous packet — refusing to start would turn a build
 * step into an outage for a window that does not need the addon yet.
 */
const startNativeSurface = (): void => {
    const events = createEventForwarder({
        target: rendererTarget,
        schedule: queueMicrotask,
        channel: EVENT_CHANNEL,
    });

    const addonPath = nativeAddonPath();
    try {
        const addon = loadNativeAddon({ path: addonPath, load: createRequire(import.meta.url) });
        nativeHost = new addon.SourdawNative((event, payload) => {
            forwardNativeEvent(event, payload, events, rendererTarget);
        });
    } catch (error) {
        console.error(
            `[shell] the native addon at ${addonPath} did not load: ${String(error)}. ` +
                `Set ${NATIVE_ADDON_PATH_ENV} to a built addon; native commands are unavailable until then.`
        );
    }

    // Registration is unconditional. A known command whose backend is missing
    // must reject through the router's native-host check; leaving the channel
    // unregistered surfaces Electron's own error on every renderer call —
    // once per second for the diagnostics poll.
    registerCommandRouter({
        ipcMain,
        native: () => nativeHost,
        isTrustedFrameUrl: isAllowedFrameUrl,
        createStream: (streamId) => createCommandStream({ streamId, target: rendererTarget, channel: STREAM_CHANNEL }),
        acceptsCommand: pluginCommandAdmission.acceptsCommand,
        // Every exposed command except the one whose backend is another
        // process. Its channel is registered by `registerScanCommand`, so the
        // renderer-visible surface is identical either way.
        commands: EXPOSED_COMMANDS.filter((command) => command !== SCAN_COMMAND),
    });

    registerVoiceDictation({ ipcMain, native: () => nativeHost, isTrustedFrameUrl: isAllowedFrameUrl });

    scanSupervisor = createUtilityScanSupervisor(addonPath);
    registerScanCommand({
        ipcMain,
        isTrustedFrameUrl: isAllowedFrameUrl,
        supervisor: scanSupervisor,
        acceptsCommand: pluginCommandAdmission.acceptsCommand,
    });

    if (nativeHost !== undefined) {
        pluginWindowHost = registerPluginWindowHost(nativeHost, {
            createWindow: createEditorWindow,
            getParentWindow: () => (mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined),
            getScaleFactor: editorWindowScaleFactor,
            // A display added, removed, or rescaled changes the density under
            // every open editor at once, and none of them moved.
            watchDisplayChanges: (onChanged) => {
                screen.on('display-metrics-changed', onChanged);
            },
        });
    }
};

void app.whenReady().then(() => {
    handleAppProtocol(resolveContentRoots());
    applyPermissionPolicy(session.defaultSession, { allowedOrigins: allowedOrigins() });

    // The frameless Linux chrome draws its own controls; the default
    // application menu would sit above them as a second, boilerplate title
    // bar. Only Linux is frameless: macOS keeps its menu because editing
    // shortcuts there come from the menu bar, and Windows keeps its native
    // chrome, menu included.
    if (process.platform === 'linux') {
        Menu.setApplicationMenu(null);
    } else if (process.platform === 'darwin') {
        rebuildMacApplicationMenu();
    }

    registerDialogChannels({ ipcMain, isTrustedFrameUrl: isAllowedFrameUrl, dialogs: dialog });
    registerPathChannels({
        ipcMain,
        isTrustedFrameUrl: isAllowedFrameUrl,
        // The same root-absolute path the web build uses, made absolute so it
        // also resolves from worker and worklet contexts.
        samplesBaseUrl: `${APP_ORIGIN}/samples`,
        join,
    });
    registerWindowControlChannels({
        ipcMain,
        isTrustedFrameUrl: isAllowedFrameUrl,
        // The router keeps IPC events structurally untyped so it stays
        // Electron-free; an invoke event's sender is always a WebContents.
        // Anything else has no window to drive.
        windowForSender: (sender) =>
            typeof sender === 'object' && sender !== null && 'id' in sender
                ? BrowserWindow.fromWebContents(sender as WebContents)
                : null,
    });
    registerNativeMenuChannels({
        ipcMain,
        isTrustedFrameUrl: isAllowedFrameUrl,
        onProjectState: (state, sender) => {
            const senderWindow =
                typeof sender === 'object' && sender !== null
                    ? BrowserWindow.fromWebContents(sender as WebContents)
                    : null;
            if (senderWindow !== mainWindow) {
                return;
            }
            nativeMenuProjectStateController.apply(state);
            nativeMenuActionDispatcher.rendererReady(senderWindow);
        },
        onSaveResult: (result) => windowCloseCoordinator.resolveSave(result),
        editTargetForSender: (sender) =>
            typeof sender === 'object' &&
            sender !== null &&
            'undo' in sender &&
            'redo' in sender &&
            'cut' in sender &&
            'copy' in sender &&
            'paste' in sender &&
            'selectAll' in sender
                ? (sender as WebContents)
                : null,
    });
    startNativeSurface();

    createAndActivateWindow();
});

/**
 * Quit is explicit (REQ-012).
 *
 * Rust drop order is load bearing and Node does not reliably run destructors at
 * process exit, so the cascade is called rather than waited for. The deadline
 * is what keeps a third-party plugin editor from wedging quit: past it the
 * shell exits anyway, because a musician who cannot close the app will kill it,
 * and that is strictly worse.
 */
app.on(
    'before-quit',
    createQuitHandler(
        (): Promise<ShutdownOutcome> =>
            runBeforeQuitCascade({
                refusePluginCommands: () => pluginCommandAdmission.refusePluginCommands(),
                // The scan worker holds its own addon instance and its own tree
                // of per-plugin child processes; a hostile plugin can already
                // have wedged it, so dispose before waiting on the host cascade.
                disposeScanSupervisor: () => scanSupervisor?.dispose(),
                host: nativeHost,
                timers: systemTimers,
            }),
        {
            exit: (code) => app.exit(code),
            report: (outcome) => {
                if (outcome.status !== 'completed') {
                    console.error(`[shell] shutdown ${outcome.status}: ${JSON.stringify(outcome)}`);
                }
            },
            canQuit: async () => {
                const approved = await windowCloseCoordinator.requestClose();
                if (approved) {
                    rendererSessionLifecycle.approveTeardown();
                }
                return approved;
            },
            beforeRun: quiesceApprovedMainWindow,
            timers: systemTimers,
        }
    )
);

/**
 * Recreate budget for a crashing renderer.
 *
 * A renderer crash must not take the session's window with it: recreating it
 * costs the user a reload, leaving a dead window costs them the app. But a
 * crash that reproduces on load — a bad build, a GPU driver fault, a corrupt
 * project restored on startup — turns an unconditional recreate into a spin
 * that burns the machine and never lets the user read the failure. So the
 * shell recreates a bounded number of times inside a rolling window and then
 * stops and says why.
 */
const MAX_RECREATES = 3;
const RECREATE_WINDOW_MS = 60_000;
let recreateTimestamps: number[] = [];

app.on('render-process-gone', (_event, contents, details) => {
    console.error(`[shell] render process gone: ${details.reason} (exitCode ${details.exitCode})`);
    if (details.reason === 'clean-exit') {
        return;
    }

    const crashedWindow = BrowserWindow.fromWebContents(contents);
    // Only the session window is recreated. A crashed webview belonging to
    // something else must not resurrect itself as the main window.
    if (crashedWindow !== mainWindow) {
        return;
    }

    // Captured before the replacement window rebinds teardown to itself:
    // destroying the new window after a crash would leave the dead parent —
    // and every editor parented to it — on the CloseImmediately path.
    const destroyCrashed = destroyMainWindowAfterEditorsDetach;
    const destroyCrashedWindow = (): void => {
        if (crashedWindow === null) {
            return;
        }
        destroyCrashedMainWindow(crashedWindow, destroyCrashed);
    };

    if (!rendererSessionLifecycle.shouldRecreateAfterCrash()) {
        destroyCrashedWindow();
        if (mainWindow === crashedWindow) {
            mainWindow = undefined;
        }
        return;
    }

    const now = Date.now();
    recreateTimestamps = recreateTimestamps.filter((at) => now - at < RECREATE_WINDOW_MS);
    if (recreateTimestamps.length >= MAX_RECREATES) {
        destroyCrashedWindow();
        windowCloseCoordinator.clearForNoWindow();
        mainWindow = undefined;
        console.error(
            `[shell] renderer crashed ${String(recreateTimestamps.length + 1)} times within ${String(RECREATE_WINDOW_MS / 1000)}s, not recreating`
        );
        // Deliberately ends with no window. `showErrorBox` is modal, so the
        // user reads the reason first; afterwards `window-all-closed` quits on
        // Windows and Linux, and on macOS the app sits windowless, which is
        // that platform's normal state. Either way the loop is over.
        dialog.showErrorBox(
            'Sourdaw stopped responding',
            `The window crashed repeatedly (last reason: ${details.reason}). Sourdaw has stopped reopening it to avoid a crash loop. Quit and reopen the app; if it keeps happening, the log from this run is the place to start.`
        );
        return;
    }

    recreateTimestamps.push(now);
    // Replacement first, dead window second. `window-all-closed` quits the app
    // everywhere but macOS, and destroying the only window is what raises it —
    // so a destroy-then-create order leaves an instant with zero windows in
    // which the recovery path quits instead of recovering, on two of the three
    // platforms. Building the replacement first means that instant never
    // exists, and no ordering question about when Electron emits the event has
    // to be answered.
    createAndActivateWindow();
    destroyCrashedWindow();
});

// A GPU or utility process can die without the session being lost. Record it
// and stay up: killing the app here would throw away unsaved work over a
// process the app can do without.
app.on('child-process-gone', (_event, details) => {
    console.error(
        `[shell] child process gone: type=${details.type} reason=${details.reason} name=${details.name ?? 'unknown'}`
    );
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
        createAndActivateWindow();
    }
});
