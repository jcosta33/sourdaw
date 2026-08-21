import { expect, test } from '@playwright/test';

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
    expect(rendered.pcmLength).toBe(22_054);
    expectConditionedAudioSignature(rendered.signature);
});
