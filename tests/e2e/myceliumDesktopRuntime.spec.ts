import { expect, test } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';
import {
    bindMyceliumEvidence,
    captureMyceliumProjectReceipt,
    captureMyceliumSourceReceipt,
} from './myceliumEvidenceReceipt';

const ALLOWED_WARNING_FRAGMENTS = [
    'using deprecated parameters for `initSync()`',
    '[MIDI] Web MIDI failed, trying Tauri fallback',
    'No available adapters.',
] as const;

type RuntimeCall = { command: string; args: unknown };

test('launches Mycelium through the Tauri v2 desktop-runtime contract', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const sourceReceipt = captureMyceliumSourceReceipt(testInfo.config.metadata);
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new TypeError('Mycelium desktop-runtime E2E requires a configured Playwright baseURL');
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

    await page.addInitScript(() => {
        type RuntimeCallback = (payload: unknown) => unknown;
        const calls: RuntimeCall[] = [];
        const callbacks = new Map<number, RuntimeCallback>();
        let nextCallbackId = 1;

        Reflect.set(window, '__MYCELIUM_TAURI_CALLS__', calls);
        Reflect.deleteProperty(window, '__TAURI__');
        Reflect.set(window, '__TAURI_INTERNALS__', {
            callbacks,
            convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
            invoke: (command: string, args: unknown) => {
                calls.push({ command, args });
                if (command === 'list_midi_inputs') {
                    return Promise.resolve([]);
                }
                return Promise.reject(new Error(`Unexpected native command: ${command}`));
            },
            metadata: {
                currentWindow: { label: 'main' },
                currentWebview: { label: 'main', windowLabel: 'main' },
            },
            runCallback: (id: number, payload: unknown) => callbacks.get(id)?.(payload),
            transformCallback: (callback: RuntimeCallback, once = false) => {
                const id = nextCallbackId;
                nextCallbackId += 1;
                callbacks.set(id, (payload) => {
                    const result = callback(payload);
                    if (once) {
                        callbacks.delete(id);
                    }
                    return result;
                });
                return id;
            },
            unregisterCallback: (id: number) => callbacks.delete(id),
        });
    });

    await setupWorkspace(page);
    expect(await page.evaluate(() => Reflect.has(window, '__TAURI_INTERNALS__'))).toBe(true);
    expect(await page.evaluate(() => Reflect.has(window, '__TAURI__'))).toBe(false);
    await page.locator('#launch-demo-project').click();
    const card = page.getByRole('button', { name: /Mycelium Ascendant/i });
    await expect(card).toBeVisible();
    await card.click();
    await wait_for_workspace_ready(page);
    const projectReceipt = await captureMyceliumProjectReceipt(page);

    await expect(page.getByRole('button', { name: /^Mycelium Ascendant/ })).toBeVisible();
    const trackList = page.getByRole('grid', { name: /Track list/i });
    await expect(trackList.getByRole('row').filter({ hasText: 'Kick' }).first()).toBeVisible();
    await expect(trackList.getByRole('row').filter({ hasText: 'Main Vision' }).first()).toBeVisible();
    await expect(trackList.getByRole('row').filter({ hasText: 'Temple Chamber' }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Arrangement sections' })).toContainText('Sporefall');

    const runtimeCalls = await page.evaluate(() => {
        const calls: unknown = Reflect.get(window, '__MYCELIUM_TAURI_CALLS__');
        if (!Array.isArray(calls)) {
            return [];
        }
        return calls.filter(
            (call: unknown): call is RuntimeCall =>
                typeof call === 'object' && call !== null && typeof Reflect.get(call, 'command') === 'string'
        );
    });
    const evidence = bindMyceliumEvidence({
        source: sourceReceipt,
        project: projectReceipt,
        measurements: { capturedAt: new Date().toISOString(), runtimeCalls },
    });
    await testInfo.attach('mycelium-desktop-runtime-log', {
        body: JSON.stringify(evidence),
        contentType: 'application/json',
    });

    expect(sourceReceipt.sourceDirty).toBe(false);
    expect(projectReceipt).toMatchObject({
        durationBeats: 576,
        trackCount: 43,
        clipCount: 119,
        noteCount: 3_818,
        automationLaneCount: 115,
        automationPointCount: 1_622,
    });
    expect(runtimeCalls).toEqual([{ command: 'list_midi_inputs', args: {} }]);
    expect(consoleErrors).toEqual([]);
    expect(unexpectedWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(httpErrors).toEqual([]);
});
