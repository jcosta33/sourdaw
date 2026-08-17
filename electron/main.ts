/**
 * Electron main process (REQ-001).
 *
 * The shell hosts the unmodified web build. It adds no preload and exposes no
 * bridge, so `isTauri()` is false in the renderer and the app runs its browser
 * path — that is deliberate for this scaffold: the shell is proven on its own
 * before any native surface is attached to it.
 */
import { app, BrowserWindow, dialog, session, shell } from 'electron';

import { APP_ENTRY_URL, APP_ORIGIN, handleAppProtocol, registerAppScheme, resolveContentRoots } from './protocol.js';
import { applyPermissionPolicy, normalizeOrigin } from './security.js';

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

const isAllowedNavigation = (url: string): boolean => {
    const origin = normalizeOrigin(url);
    return origin !== undefined && allowedOrigins().some((allowed) => normalizeOrigin(allowed) === origin);
};

let mainWindow: BrowserWindow | undefined;

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
        // The URL comes from the renderer and is not guaranteed to parse. An
        // exception here propagates into Electron's window-open path rather
        // than denying, so parse defensively and treat unparseable as hostile.
        try {
            if (/^https?:$/.test(new URL(url).protocol)) {
                void shell.openExternal(url);
            }
        } catch {
            console.warn(`[shell] blocked unparseable window-open target: ${url}`);
        }
        return { action: 'deny' };
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
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 600,
        title: 'Sourdaw',
        backgroundColor: '#000000',
        show: false,
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
        },
    });

    window.once('ready-to-show', () => window.show());
    attachWebContentsPolicy(window);
    void window.loadURL(entryUrl);
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

void app.whenReady().then(() => {
    handleAppProtocol(resolveContentRoots());
    applyPermissionPolicy(session.defaultSession, { allowedOrigins: allowedOrigins() });
    mainWindow = createWindow();
});

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

    const destroyCrashedWindow = (): void => {
        if (crashedWindow !== null && !crashedWindow.isDestroyed()) {
            crashedWindow.destroy();
        }
    };

    const now = Date.now();
    recreateTimestamps = recreateTimestamps.filter((at) => now - at < RECREATE_WINDOW_MS);
    if (recreateTimestamps.length >= MAX_RECREATES) {
        destroyCrashedWindow();
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
    mainWindow = createWindow();
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
        mainWindow = createWindow();
    }
});
