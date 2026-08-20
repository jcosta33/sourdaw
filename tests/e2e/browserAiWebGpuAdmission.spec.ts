/// <reference types="@webgpu/types" />

import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const CAPABILITY_STORAGE_KEY = 'sourdaw-browser-ai-capability';

test('reports the live Chromium WebGPU adapter/device outcome at the Browser AI boundary', async ({
    page,
}, testInfo) => {
    await setupWorkspace(page);
    await launch_new_project(page);

    await expect
        .poll(() => page.evaluate((key) => window.localStorage.getItem(key) !== null, CAPABILITY_STORAGE_KEY))
        .toBe(true);
    const observedOutcome: unknown = await page.evaluate((key) => {
        const cached = window.localStorage.getItem(key);
        if (cached === null) {
            return null;
        }
        const report: unknown = JSON.parse(cached);
        return typeof report === 'object' && report !== null ? Reflect.get(report, 'webGpu') : null;
    }, CAPABILITY_STORAGE_KEY);
    await testInfo.attach('webgpu-admission-outcome', {
        body: JSON.stringify(observedOutcome),
        contentType: 'application/json',
    });
    expect(observedOutcome).toEqual({ status: 'supported' });

    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();

    const capabilityStatus = page.getByRole('status', { name: 'Browser AI capabilities' });
    await expect(capabilityStatus).toBeVisible();
    const webGpuRow = capabilityStatus.getByText('WebGPU', { exact: true }).locator('..');
    await expect(webGpuRow.getByText('Available', { exact: true })).toBeVisible();
    await expect(capabilityStatus.getByText('Not Measured', { exact: true })).toBeVisible();
});
