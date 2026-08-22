import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const ALLOWED_WARNING_FRAGMENTS = [
    'using deprecated parameters for `initSync()`',
    '[MIDI] Web MIDI failed',
    'No available adapters.',
] as const;

type RuntimeCall = { command: string; args: unknown };

test('launches a project through the window.sourdaw desktop-runtime contract', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new TypeError('Desktop-runtime E2E requires a configured Playwright baseURL');
    }
    const appOrigin = new URL(configuredBaseUrl).origin;
    const consoleErrors: string[] = [];
    const unexpectedWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const externalRequests: string[] = [];
    const httpErrors: string[] = [];

    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') {
            consoleErrors.push(text);
        }
        if (message.type() === 'warning' && !ALLOWED_WARNING_FRAGMENTS.some((fragment) => text.includes(fragment))) {
            unexpectedWarnings.push(text);
        }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? 'unknown request failure';
        if (failure !== 'net::ERR_ABORTED') {
            failedRequests.push(`${failure} ${request.method()} ${request.url()}`);
        }
    });
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== appOrigin) {
            externalRequests.push(`${request.method()} ${request.url()}`);
        }
    });
    page.on('response', (response) => {
        if (response.status() >= 400) {
            httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
        }
    });

    // Stand in for the Electron preload: publish `window.sourdaw` with the
    // exact `SourdawDesktopBridge` surface, so every desktop capability gate
    // (`'sourdaw' in window`) takes its native branch. Every command path
    // records what crossed the seam and then refuses, so an unexpected native
    // call is visible in the log below instead of silently succeeding.
    await page.addInitScript(() => {
        const calls: RuntimeCall[] = [];
        const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

        const refuseCommand = (command: string, args: unknown): Promise<never> => {
            calls.push({ command, args });
            return Promise.reject(new Error(`Unexpected native command: ${command}`));
        };

        const bridge: SourdawDesktopBridge = {
            invoke: (command, args = []) => {
                calls.push({ command, args });
                if (command === 'list_midi_inputs') {
                    return Promise.resolve([]);
                }
                if (command === 'unload_plugin') {
                    // Project activation clears plugin state; nothing is
                    // loaded here, so report zero unloads and zero errors.
                    return Promise.resolve([[], []]);
                }
                if (command === 'engine_rt_diagnostics') {
                    // The diagnostics poll reads this every second; the
                    // stubbed engine is simply not running.
                    return Promise.resolve({ running: false, events: [] });
                }
                return Promise.reject(new Error(`Unexpected native command: ${command}`));
            },
            invokeBinary: (command, meta, bytes) => refuseCommand(command, [...meta, bytes]),
            invokeBinaryResponse: (command, args = []) => refuseCommand(command, args),
            // Subscribing crosses no IPC in the real bridge either — the
            // preload keeps one process-wide listener and dispatches by name.
            listen: (event, callback) => {
                const listeners = eventListeners.get(event) ?? new Set<(payload: unknown) => void>();
                listeners.add(callback);
                eventListeners.set(event, listeners);
                return () => {
                    listeners.delete(callback);
                };
            },
            stream: (command, args) => refuseCommand(command, args),
            dialog: {
                open: () => Promise.reject(new Error('Unexpected native dialog: open')),
                save: () => Promise.reject(new Error('Unexpected native dialog: save')),
                message: () => Promise.reject(new Error('Unexpected native dialog: message')),
            },
            paths: {
                samplesBase: () => Promise.reject(new Error('Unexpected native path call: samplesBase')),
                join: () => Promise.reject(new Error('Unexpected native path call: join')),
            },
            voiceDictation: {
                start: () => Promise.reject(new Error('Unexpected native dictation call: start')),
                stop: () => Promise.reject(new Error('Unexpected native dictation call: stop')),
                cancel: () => Promise.reject(new Error('Unexpected native dictation call: cancel')),
                // Subscribing crosses no IPC, matching `listen` above; the
                // unsubscribe is a no-op because nothing here ever emits.
                listenTerminal: () => () => undefined,
            },
        };

        Reflect.set(window, '__SOURDAW_BRIDGE_CALLS__', calls);
        Reflect.set(window, 'sourdaw', bridge);
    });

    await setupWorkspace(page);
    expect(await page.evaluate(() => 'sourdaw' in window)).toBe(true);
    await launch_new_project(page);
    await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();

    const runtimeCalls = await page.evaluate(() => {
        const calls: unknown = Reflect.get(window, '__SOURDAW_BRIDGE_CALLS__');
        if (!Array.isArray(calls)) {
            return [];
        }
        return calls.filter(
            (call: unknown): call is RuntimeCall =>
                typeof call === 'object' && call !== null && typeof Reflect.get(call, 'command') === 'string'
        );
    });
    await testInfo.attach('desktop-runtime-log', {
        body: JSON.stringify({ capturedAt: new Date().toISOString(), runtimeCalls }),
        contentType: 'application/json',
    });

    // The diagnostics poll fires every second, so its call count depends on
    // how long the launch took — assert its shape, not its cardinality.
    const diagnosticsCalls = runtimeCalls.filter((call) => call.command === 'engine_rt_diagnostics');
    expect(diagnosticsCalls.length).toBeGreaterThan(0);
    for (const call of diagnosticsCalls) {
        expect(call.args).toEqual([]);
    }

    // Beyond the poll, exactly two native crossings: the MIDI fallback
    // enumerating input ports, then project activation clearing plugin state
    // (its optional instance id crosses as an undefined positional slot). The
    // bridge takes positional arguments, so a no-argument command arrives as
    // an empty array.
    expect(runtimeCalls.filter((call) => call.command !== 'engine_rt_diagnostics')).toEqual([
        { command: 'list_midi_inputs', args: [] },
        { command: 'unload_plugin', args: [undefined] },
    ]);
    expect(consoleErrors).toEqual([]);
    expect(unexpectedWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(httpErrors).toEqual([]);
});
