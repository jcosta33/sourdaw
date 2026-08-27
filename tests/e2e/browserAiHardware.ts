/// <reference types="@webgpu/types" />

import { type Page } from '@playwright/test';

export type BrowserWebGpuHardwareProbe =
    | { status: 'supported' }
    | {
          reason:
              | 'adapter-request-failed'
              | 'adapter-unavailable'
              | 'api-unavailable'
              | 'fallback-adapter'
              | 'device-unavailable';
          status: 'unavailable';
      };

export type BrowserAiWebGpuHardwareRequirement = 'optional' | 'required';

export function getBrowserAiWebGpuHardwareRequirement(
    metadata: Readonly<Record<string, unknown>>
): BrowserAiWebGpuHardwareRequirement {
    const configuredRequirement = metadata.browserAiWebGpuHardware;
    if (configuredRequirement === undefined) {
        return 'optional';
    }
    if (configuredRequirement === 'required') {
        return 'required';
    }
    throw new TypeError('Browser AI WebGPU proof configuration has an invalid hardware requirement');
}

/**
 * Measures Chromium's WebGPU adapter directly, outside Sourdaw's capability
 * detection and persisted report. It mirrors the production admission boundary:
 * a core, non-fallback adapter must create a device, which the probe destroys
 * before returning. A product regression therefore cannot turn a failing
 * admission assertion into a skip.
 */
export async function probeBrowserWebGpuHardwareInPage(): Promise<BrowserWebGpuHardwareProbe> {
    if (!('gpu' in navigator)) {
        return { status: 'unavailable', reason: 'api-unavailable' };
    }
    let adapter: GPUAdapter | null;
    try {
        adapter = await navigator.gpu.requestAdapter({
            featureLevel: 'core',
            forceFallbackAdapter: false,
        });
    } catch {
        return { status: 'unavailable', reason: 'adapter-request-failed' };
    }
    try {
        if (adapter === null) {
            return { status: 'unavailable', reason: 'adapter-unavailable' };
        }
        let isFallbackAdapter: unknown;
        try {
            isFallbackAdapter = Reflect.get(adapter.info, 'isFallbackAdapter');
        } catch {
            return { status: 'unavailable', reason: 'adapter-unavailable' };
        }
        if (isFallbackAdapter !== false) {
            return {
                status: 'unavailable',
                reason: isFallbackAdapter === true ? 'fallback-adapter' : 'adapter-unavailable',
            };
        }
        const device = await adapter.requestDevice();
        device.destroy();
        return { status: 'supported' };
    } catch {
        return { status: 'unavailable', reason: 'device-unavailable' };
    }
}

export async function probeBrowserWebGpuHardware(page: Page): Promise<BrowserWebGpuHardwareProbe> {
    return page.evaluate(probeBrowserWebGpuHardwareInPage);
}

export function requireBrowserWebGpuHardware(probe: BrowserWebGpuHardwareProbe): void {
    if (probe.status === 'supported') {
        return;
    }
    throw new Error(`This Browser AI proof requires hardware WebGPU (${probe.reason})`);
}
