/// <reference types="@webgpu/types" />

import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const CAPABILITY_STORAGE_KEY = 'sourdaw-browser-ai-capability';

test('admits the live Chromium runtime from required Browser AI capabilities', async ({ page }, testInfo) => {
    await setupWorkspace(page);
    await launch_new_project(page);

    await expect
        .poll(() => page.evaluate((key) => window.localStorage.getItem(key) !== null, CAPABILITY_STORAGE_KEY))
        .toBe(true);
    const observedReport: unknown = await page.evaluate((key) => {
        const cached = window.localStorage.getItem(key);
        if (cached === null) {
            return null;
        }
        return JSON.parse(cached) as unknown;
    }, CAPABILITY_STORAGE_KEY);
    await testInfo.attach('browser-ai-capability-report', {
        body: JSON.stringify(observedReport),
        contentType: 'application/json',
    });
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
