/// <reference types="@webgpu/types" />

import { test, type Page } from '@playwright/test';

export type BrowserWebGpuHardwareProbe =
    | { status: 'supported' }
    | { reason: 'adapter-request-failed' | 'adapter-unavailable' | 'api-unavailable'; status: 'unavailable' };

/**
 * Measures Chromium's WebGPU adapter directly, outside Sourdaw's capability
 * detection and persisted report. A product regression therefore cannot turn
 * a failing admission assertion into a skip.
 */
export async function probeBrowserWebGpuHardware(page: Page): Promise<BrowserWebGpuHardwareProbe> {
    return page.evaluate(async (): Promise<BrowserWebGpuHardwareProbe> => {
        if (!('gpu' in navigator)) {
            return { status: 'unavailable', reason: 'api-unavailable' };
        }
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return adapter === null
                ? { status: 'unavailable', reason: 'adapter-unavailable' }
                : { status: 'supported' };
        } catch {
            return { status: 'unavailable', reason: 'adapter-request-failed' };
        }
    });
}

export function skipWithoutBrowserWebGpu(probe: BrowserWebGpuHardwareProbe): void {
    const reason = probe.status === 'unavailable' ? probe.reason : 'adapter available';
    test.skip(probe.status === 'unavailable', `requires hardware WebGPU (${reason})`);
}
