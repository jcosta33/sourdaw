import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { terminateChildProcess, withIsolatedElectronUserData } from '../../scripts/electronE2EIsolation';

type DdspAudioSignature = {
    activeRatio: number;
    crestFactor: number;
    meanAbsolute: number;
    middleRms: number;
    peak: number;
    rms: number;
    zeroCrossingRate: number;
};

type DdspProbe = {
    prepare: () => Promise<{ ready: boolean; artifactCount: number }>;
    renderOffline: () => Promise<{
        backend: string;
        pcmLength: number;
        finite: boolean;
        signature: DdspAudioSignature;
    }>;
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

function expectConditionedAudioSignature(signature: DdspAudioSignature): void {
    expect(signature.rms).toBeGreaterThan(0.005);
    expect(signature.rms).toBeLessThan(0.05);
    expect(signature.peak).toBeGreaterThan(0.02);
    expect(signature.peak).toBeLessThan(0.2);
    expect(signature.meanAbsolute).toBeGreaterThan(0.003);
    expect(signature.meanAbsolute).toBeLessThan(0.03);
    expect(signature.middleRms).toBeGreaterThan(0.005);
    expect(signature.middleRms).toBeLessThan(0.04);
    expect(signature.activeRatio).toBeGreaterThan(0.9);
    expect(signature.crestFactor).toBeGreaterThan(3.5);
    expect(signature.crestFactor).toBeLessThan(8);
    expect(signature.zeroCrossingRate).toBeGreaterThan(0.04);
    expect(signature.zeroCrossingRate).toBeLessThan(0.08);
}

test('Electron renderer recreates the WebGPU DDSP worker offline from OPFS', async () => {
    assertCurrentDevShellOutput();

    await withIsolatedElectronUserData({
        launch: ({ argument }) =>
            electron.launch({
                executablePath: ELECTRON_EXECUTABLE,
                args: [MAIN_ENTRY, argument],
                env: {
                    ...process.env,
                    SOURDAW_DESKTOP_DEV: '1',
                    SOURDAW_DEV_SERVER_URL: PROBE_URL,
                    SOURDAW_DESKTOP_PROBE_EXIT_MS: '170000',
                },
            }),
        run: async (app) => {
            const page = await app.firstWindow();
            await page.waitForURL(PROBE_URL);
            await expect.poll(() => page.evaluate(() => typeof window.__SOURDAW_DDSP_PROBE__)).toBe('object');

            const prepared = await page.evaluate(() => window.__SOURDAW_DDSP_PROBE__!.prepare());
            expect(prepared).toEqual({ ready: true, artifactCount: 3 });
            await page
                .context()
                .route('https://storage.googleapis.com/magentadata/**', (route) => route.abort('blockedbyclient'));

            const rendered = await page.evaluate(() => window.__SOURDAW_DDSP_PROBE__!.renderOffline());
            expect(rendered).toMatchObject({ backend: 'webgpu', pcmLength: 22_054, finite: true });
            expectConditionedAudioSignature(rendered.signature);
        },
        shutdown: async (app) => {
            const child = app.process();
            try {
                await app.close();
            } finally {
                await terminateChildProcess(child);
            }
        },
    });
});
