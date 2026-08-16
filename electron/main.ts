/**
 * Electron main process (REQ-001).
 *
 * The shell hosts the unmodified web build. It adds no preload and exposes no
 * bridge, so `isTauri()` is false in the renderer and the app runs its browser
 * path — that is deliberate for this scaffold: the shell is proven on its own
 * before any native surface is attached to it.
 */
import { app, BrowserWindow, session, shell } from 'electron';

import { APP_ENTRY_URL, APP_ORIGIN, handleAppProtocol, registerAppScheme, resolveContentRoots } from './protocol.js';
import { applyPermissionPolicy, normalizeOrigin } from './security.js';

// Before anything that can await. Chromium builds its privileged-scheme table
// once, at `ready`; the ESM main entry resumes after `ready` at the first await,
// and a scheme registered then is silently an ordinary opaque scheme.
registerAppScheme();

/**
 * Opt the renderer into a configurable AudioWorklet render quantum.
 *
 * Chromium's fixed 128-frame quantum forces the DSP graph to run at a block
 * size the engine did not choose, which costs CPU on large sessions and pins
 * the smallest achievable latency. The feature is behind a flag in the Chromium
 * that Electron 43 ships.
 *
 * REMOVE when the shell moves to Electron 45 or later, where the feature is
 * expected to be on by default — re-check by 2026-12-31 and delete this switch
 * (and this comment) the moment `WebAudioConfigurableRenderQuantum` is no
 * longer a runtime flag. A stale `--enable-features` entry naming a graduated
 * or dropped feature is silently ignored, so nothing fails to tell us.
 */
app.commandLine.appendSwitch('enable-features', 'WebAudioConfigurableRenderQuantum');

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
        if (/^https?:$/.test(new URL(url).protocol)) {
            void shell.openExternal(url);
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
 */
const runIsolationProbe = async (window: BrowserWindow): Promise<void> => {
    const probe = `(async () => {
        const response = await fetch(location.href, { cache: 'no-store' });
        const probeAsset = async (path) => {
            try {
                const assetResponse = await fetch(path, { cache: 'no-store' });
                return assetResponse.status;
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

// A renderer crash must not take the session's window with it. Recreating it
// costs the user a reload; leaving a dead window costs them the app.
app.on('render-process-gone', (_event, contents, details) => {
    console.error(`[shell] render process gone: ${details.reason} (exitCode ${details.exitCode})`);
    if (details.reason === 'clean-exit') {
        return;
    }
    const window = BrowserWindow.fromWebContents(contents);
    if (window !== null && !window.isDestroyed()) {
        window.destroy();
    }
    mainWindow = createWindow();
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
