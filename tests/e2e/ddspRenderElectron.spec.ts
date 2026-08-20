import { _electron as electron, expect, test } from '@playwright/test';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

type DdspProbe = {
    prepare: () => Promise<{ ready: boolean; artifactCount: number }>;
    renderOffline: () => Promise<{ backend: string; pcmLength: number; finite: boolean }>;
};

declare global {
    // oxlint-disable-next-line typescript/consistent-type-definitions -- Window must merge with the DOM global.
    interface Window {
        __SOURDAW_DDSP_PROBE__?: DdspProbe;
    }
}

const PROBE_URL = 'http://127.0.0.1:5192/tests/e2e/ddspRenderProbe.html';
const ELECTRON_EXECUTABLE = join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const MAIN_ENTRY = join(process.cwd(), 'electron/out/main.js');

test('Electron renderer recreates the WebGPU DDSP worker offline from OPFS', async () => {
    expect(existsSync(ELECTRON_EXECUTABLE)).toBe(true);
    expect(existsSync(MAIN_ENTRY)).toBe(true);

    const app = await electron.launch({
        executablePath: ELECTRON_EXECUTABLE,
        args: [MAIN_ENTRY],
        env: {
            ...process.env,
            SOURDAW_DESKTOP_DEV: '1',
            SOURDAW_DEV_SERVER_URL: PROBE_URL,
            SOURDAW_DESKTOP_PROBE_EXIT_MS: '170000',
        },
    });
    try {
        const page = await app.firstWindow();
        await page.waitForURL(PROBE_URL);
        await expect.poll(() => page.evaluate(() => typeof window.__SOURDAW_DDSP_PROBE__)).toBe('object');

        const prepared = await page.evaluate(() => window.__SOURDAW_DDSP_PROBE__!.prepare());
        expect(prepared).toEqual({ ready: true, artifactCount: 3 });
        await page.context().route('https://storage.googleapis.com/magentadata/**', (route) => route.abort('blockedbyclient'));

        const rendered = await page.evaluate(() => window.__SOURDAW_DDSP_PROBE__!.renderOffline());
        expect(rendered).toEqual({ backend: 'webgpu', pcmLength: 80_000, finite: true });
    } finally {
        await app.close();
    }
});
