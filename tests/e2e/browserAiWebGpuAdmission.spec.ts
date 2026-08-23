import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { probeBrowserWebGpuHardware, skipWithoutBrowserWebGpu } from './browserAiHardware';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const CAPABILITY_STORAGE_KEY = 'sourdaw-browser-ai-capability';

type DdspRenderProbe = {
    prepare: () => Promise<{ artifactCount: number; ready: boolean }>;
    renderOffline: () => Promise<{
        admissionWithheld: boolean;
        backend: string;
        finite: boolean;
        peak: number;
        pcmLength: number;
    }>;
};

type BrowserAiCapabilityReport = {
    capability: 'supported' | 'unsupported-browser';
    crossOriginIsolated: boolean;
    opfsAvailable: boolean;
    webGpu: { reason?: string; status: 'supported' | 'unavailable' };
    workerAvailable: boolean;
};

declare global {
    // oxlint-disable-next-line typescript/consistent-type-definitions -- Window must merge with the DOM global.
    interface Window {
        __SOURDAW_DDSP_RENDER_PROBE__?: DdspRenderProbe;
    }
}

function isBrowserAiCapabilityReport(value: unknown): value is BrowserAiCapabilityReport {
    if (!isRecord(value)) {
        return false;
    }
    const report = value;
    const webGpu = report.webGpu;
    return (
        (report.capability === 'supported' || report.capability === 'unsupported-browser') &&
        typeof report.crossOriginIsolated === 'boolean' &&
        typeof report.opfsAvailable === 'boolean' &&
        typeof report.workerAvailable === 'boolean' &&
        isRecord(webGpu) &&
        (webGpu.status === 'supported' || webGpu.status === 'unavailable')
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function getBrowserAiCapabilityReport(page: Page, testInfo: TestInfo): Promise<BrowserAiCapabilityReport> {
    await expect
        .poll(() => page.evaluate((key) => window.localStorage.getItem(key) !== null, CAPABILITY_STORAGE_KEY))
        .toBe(true);
    const observedReport: unknown = await page.evaluate((key) => {
        const cached = window.localStorage.getItem(key);
        if (cached === null) {
            return null;
        }
        const parsed: unknown = JSON.parse(cached);
        return parsed;
    }, CAPABILITY_STORAGE_KEY);
    await testInfo.attach('browser-ai-capability-report', {
        body: JSON.stringify(observedReport),
        contentType: 'application/json',
    });
    expect(isBrowserAiCapabilityReport(observedReport)).toBe(true);
    if (!isBrowserAiCapabilityReport(observedReport)) {
        throw new Error('Browser AI capability report did not match its public runtime contract');
    }
    return observedReport;
}

async function renderDdspAfterViteWorkerOptimization(
    page: Page
): Promise<Awaited<ReturnType<DdspRenderProbe['renderOffline']>>> {
    try {
        return await page.evaluate(() => window.__SOURDAW_DDSP_RENDER_PROBE__!.renderOffline());
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) {
            throw error;
        }
        await page.waitForLoadState('load');
        await expect.poll(() => page.evaluate(() => typeof window.__SOURDAW_DDSP_RENDER_PROBE__)).toBe('object');
        expect(page.url()).toContain('/tests/e2e/ddspRenderProbe.html');
        return page.evaluate(() => window.__SOURDAW_DDSP_RENDER_PROBE__!.renderOffline());
    }
}

test('admits the live Chromium runtime from required Browser AI capabilities', async ({ page }, testInfo) => {
    await setupWorkspace(page);
    await launch_new_project(page);

    const hardwareProbe = await probeBrowserWebGpuHardware(page);
    skipWithoutBrowserWebGpu(hardwareProbe);
    const observedReport = await getBrowserAiCapabilityReport(page, testInfo);
    expect(observedReport).toEqual(
        expect.objectContaining({
            capability: 'supported',
            webGpu: { status: 'supported' },
            crossOriginIsolated: true,
            workerAvailable: true,
            opfsAvailable: true,
        })
    );
    expect(observedReport).not.toHaveProperty('chromeVersion');

    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();

    const capabilityStatus = page.getByRole('status', { name: 'Browser AI capabilities' });
    await expect(capabilityStatus).toBeVisible();
    const webGpuRow = capabilityStatus.getByText('WebGPU', { exact: true }).locator('..');
    await expect(webGpuRow.getByText('Available', { exact: true })).toBeVisible();
    await expect(capabilityStatus.getByText('Cross-Origin Isolation', { exact: true })).toBeVisible();
    await expect(capabilityStatus.getByText('Web Workers', { exact: true })).toBeVisible();
    await expect(capabilityStatus.getByText('Not Measured', { exact: true })).toBeVisible();
});

test('renders an exact-duration DDSP preview from verified OPFS artifacts with hardware WebGPU', async ({
    page,
}, testInfo) => {
    test.setTimeout(180_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    const hardwareProbe = await probeBrowserWebGpuHardware(page);
    skipWithoutBrowserWebGpu(hardwareProbe);
    const observedReport = await getBrowserAiCapabilityReport(page, testInfo);
    expect(observedReport).toEqual(
        expect.objectContaining({
            capability: 'supported',
            webGpu: { status: 'supported' },
            crossOriginIsolated: true,
            workerAvailable: true,
            opfsAvailable: true,
        })
    );

    await page.goto('/tests/e2e/ddspRenderProbe.html');
    await expect.poll(() => page.evaluate(() => typeof window.__SOURDAW_DDSP_RENDER_PROBE__)).toBe('object');

    const prepared = await page.evaluate(() => window.__SOURDAW_DDSP_RENDER_PROBE__!.prepare());
    expect(prepared).toEqual({ ready: true, artifactCount: 3 });

    let blockedMagentaRequests = 0;
    await page.route('https://storage.googleapis.com/magentadata/**', (route) => {
        blockedMagentaRequests += 1;
        return route.abort('blockedbyclient');
    });
    const rendered = await renderDdspAfterViteWorkerOptimization(page);
    await testInfo.attach('ddsp-render-proof', {
        body: JSON.stringify({ ...rendered, blockedMagentaRequests }),
        contentType: 'application/json',
    });

    expect(rendered).toMatchObject({ admissionWithheld: false, backend: 'webgpu', finite: true });
    expect(rendered.peak).toBeGreaterThan(0);
    expect(rendered.peak).toBeLessThanOrEqual(1);
    expect(rendered.pcmLength).toBe(Math.round(0.503 * 44_100));
    expect(blockedMagentaRequests).toBe(0);
});
