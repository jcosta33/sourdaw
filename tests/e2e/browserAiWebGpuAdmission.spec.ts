/// <reference types="@webgpu/types" />

import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

type WebGpuOutcome =
    | { status: 'supported' }
    | {
          status: 'unavailable';
          reason: 'missing-surface' | 'adapter-unavailable' | 'fallback-adapter' | 'device-unavailable';
      };

const UNAVAILABLE_COPY: Record<Extract<WebGpuOutcome, { status: 'unavailable' }>['reason'], string> = {
    'missing-surface': 'WebGPU is not exposed by this Chromium runtime',
    'adapter-unavailable': 'No core WebGPU adapter is available',
    'fallback-adapter': 'Only a software WebGPU fallback adapter is available',
    'device-unavailable': 'The WebGPU adapter could not create a device',
};

test('reports the live Chromium WebGPU adapter/device outcome at the Browser AI boundary', async ({
    page,
}, testInfo) => {
    await setupWorkspace(page);
    await launch_new_project(page);

    const directOutcome = await page.evaluate(async (): Promise<WebGpuOutcome> => {
        if (!('gpu' in navigator)) {
            return { status: 'unavailable', reason: 'missing-surface' };
        }
        const adapter = await navigator.gpu
            .requestAdapter({ featureLevel: 'core', forceFallbackAdapter: false })
            .catch(() => null);
        if (!adapter) {
            return { status: 'unavailable', reason: 'adapter-unavailable' };
        }
        const isFallbackAdapter: unknown = Reflect.get(adapter.info, 'isFallbackAdapter');
        if (typeof isFallbackAdapter !== 'boolean') {
            return { status: 'unavailable', reason: 'adapter-unavailable' };
        }
        if (isFallbackAdapter) {
            return { status: 'unavailable', reason: 'fallback-adapter' };
        }
        const device = await adapter.requestDevice().catch(() => null);
        if (!device) {
            return { status: 'unavailable', reason: 'device-unavailable' };
        }
        device.destroy();
        return { status: 'supported' };
    });
    await testInfo.attach('webgpu-admission-outcome', {
        body: JSON.stringify(directOutcome),
        contentType: 'application/json',
    });

    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();

    if (directOutcome.status === 'supported') {
        await expect(page.getByRole('status', { name: 'Browser AI capabilities' })).toBeVisible();
        await expect(page.getByText('Not Measured')).toBeVisible();
    } else {
        await expect(page.getByText(UNAVAILABLE_COPY[directOutcome.reason])).toBeVisible();
    }
});
