/// <reference types="@webgpu/types" />

import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

type WebGpuOutcome =
    | { status: 'supported' }
    | {
          status: 'unavailable';
          reason:
              'missing-surface' | 'adapter-unavailable' | 'fallback-adapter' | 'device-unavailable' | 'probe-failed';
      };

const UNAVAILABLE_COPY: Record<Extract<WebGpuOutcome, { status: 'unavailable' }>['reason'], string> = {
    'missing-surface': 'WebGPU is not exposed by this Chromium runtime',
    'adapter-unavailable': 'No core WebGPU adapter is available',
    'fallback-adapter': 'Only a software WebGPU fallback adapter is available',
    'device-unavailable': 'The WebGPU adapter could not create a device',
    'probe-failed': 'The WebGPU usability check could not complete',
};

const CAPABILITY_STORAGE_KEY = 'sourdaw-browser-ai-capability';

function isWebGpuOutcome(value: unknown): value is WebGpuOutcome {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const status: unknown = Reflect.get(value, 'status');
    if (status === 'supported') {
        return true;
    }
    const reason: unknown = Reflect.get(value, 'reason');
    return status === 'unavailable' && typeof reason === 'string' && Object.hasOwn(UNAVAILABLE_COPY, reason);
}

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
    if (!isWebGpuOutcome(observedOutcome)) {
        throw new TypeError(`Browser AI cached an invalid WebGPU result: ${JSON.stringify(observedOutcome)}`);
    }
    await testInfo.attach('webgpu-admission-outcome', {
        body: JSON.stringify(observedOutcome),
        contentType: 'application/json',
    });

    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();

    if (observedOutcome.status === 'supported') {
        await expect(page.getByRole('status', { name: 'Browser AI capabilities' })).toBeVisible();
        await expect(page.getByText('Not Measured')).toBeVisible();
    } else {
        await expect(page.getByText(UNAVAILABLE_COPY[observedOutcome.reason])).toBeVisible();
    }
});
