import { expect, test } from '@playwright/test';

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

test('downloads verified Magenta artifacts then recreates a WebGPU worker offline from OPFS', async ({
    page,
}, testInfo) => {
    await page.goto('/tests/e2e/ddspRenderProbe.html');
    await expect.poll(() => page.evaluate(() => typeof window.__SOURDAW_DDSP_PROBE__)).toBe('object');

    const prepared = await page.evaluate(() => window.__SOURDAW_DDSP_PROBE__!.prepare());
    expect(prepared).toEqual({ ready: true, artifactCount: 3 });

    await page.route('https://storage.googleapis.com/magentadata/**', (route) => route.abort('blockedbyclient'));
    const rendered = await page.evaluate(() => window.__SOURDAW_DDSP_PROBE__!.renderOffline());
    await testInfo.attach('ddsp-runtime-proof', { body: JSON.stringify(rendered), contentType: 'application/json' });

    expect(rendered).toMatchObject({ backend: 'webgpu', finite: true });
    expect(rendered.pcmLength).toBe(80_000);
});
