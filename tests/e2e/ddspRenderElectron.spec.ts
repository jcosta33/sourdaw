import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

type DdspProbe = {
    prepare: () => Promise<{ ready: boolean; artifactCount: number }>;
    renderOffline: () => Promise<{ backend: string; pcmLength: number; finite: boolean }>;
};
type Provenance = { head: string; files: Record<string, string> };

declare global {
    // oxlint-disable-next-line typescript/consistent-type-definitions -- Window must merge with the DOM global.
    interface Window {
        __SOURDAW_DDSP_PROBE__?: DdspProbe;
    }
}

const PROBE_URL = 'http://127.0.0.1:5192/tests/e2e/ddspRenderProbe.html';
const ELECTRON_EXECUTABLE = join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const MAIN_ENTRY = join(process.cwd(), 'electron/out/main.js');
const PRELOAD_ENTRY = join(process.cwd(), 'electron/out/preload.cjs');
const PROVENANCE_PATH = join(process.cwd(), 'electron/out/ddsp-e2e-provenance.json');

function digest(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertCurrentDevShellOutput(): void {
    expect(existsSync(ELECTRON_EXECUTABLE)).toBe(true);
    expect(existsSync(MAIN_ENTRY)).toBe(true);
    expect(existsSync(PRELOAD_ENTRY)).toBe(true);
    expect(existsSync(PROVENANCE_PATH)).toBe(true);
    const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')) as Provenance;
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    expect(provenance.head).toBe(head);
    expect(provenance.files['electron/out/main.js']).toBe(digest(MAIN_ENTRY));
    expect(provenance.files['electron/out/preload.cjs']).toBe(digest(PRELOAD_ENTRY));
}

test('Electron renderer recreates the WebGPU DDSP worker offline from OPFS', async () => {
    assertCurrentDevShellOutput();

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
        await page
            .context()
            .route('https://storage.googleapis.com/magentadata/**', (route) => route.abort('blockedbyclient'));

        const rendered = await page.evaluate(() => window.__SOURDAW_DDSP_PROBE__!.renderOffline());
        expect(rendered).toEqual({ backend: 'webgpu', pcmLength: 22_050, finite: true });
    } finally {
        await app.close();
    }
});
