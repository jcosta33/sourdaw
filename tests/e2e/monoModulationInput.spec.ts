import { expect, test } from '@playwright/test';

test('mono sources reach both Auto Pan outputs and stay centred through Stereo Widener', async ({ page }) => {
    await page.route('/', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body></body></html>',
        })
    );
    await page.goto('/');

    const result = await page.evaluate(async () => {
        const [{ createAutoPan }, { createStereoWidener }, { applyAutoPanParams }, { applyStereoWidenerParams }] =
            await Promise.all([
                import('/src/modules/AudioEngine/repositories/devices/modulation/createAutoPan.ts'),
                import('/src/modules/AudioEngine/repositories/devices/modulation/createStereoWidener.ts'),
                import('/src/modules/AudioEngine/repositories/devices/modulation/applyAutoPanParams.ts'),
                import('/src/modules/AudioEngine/repositories/devices/modulation/applyStereoWidenerParams.ts'),
            ]);

        const sampleRate = 48_000;
        const frames = sampleRate / 2;

        async function render(kind: 'auto-pan' | 'widener', channels: 1 | 2, neutral = false) {
            const context = new OfflineAudioContext(2, frames, sampleRate);
            const device = kind === 'auto-pan' ? createAutoPan(context) : createStereoWidener(context);
            if (kind === 'widener') {
                applyStereoWidenerParams(device, { 'width-amount': neutral ? 1 : 1.5, 'width-mono-bass': 20 });
            } else if (neutral) {
                applyAutoPanParams(device, { 'autopan-depth': 0 });
            }
            const buffer = context.createBuffer(channels, frames, sampleRate);
            for (let channel = 0; channel < channels; channel++) {
                const data = buffer.getChannelData(channel);
                for (let frame = 0; frame < frames; frame++) {
                    const frequency = channel === 0 ? 1000 : 1500;
                    const amplitude = channel === 0 ? 0.2 : -0.1;
                    data[frame] = amplitude * Math.sin((2 * Math.PI * frequency * frame) / sampleRate);
                }
            }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(device.inputNode);
            device.outputNode.connect(context.destination);
            source.start();
            const rendered = await context.startRendering();
            const left = rendered.getChannelData(0);
            const right = rendered.getChannelData(1);
            let leftPeak = 0;
            let rightPeak = 0;
            let channelDifference = 0;
            for (let frame = 0; frame < frames; frame++) {
                leftPeak = Math.max(leftPeak, Math.abs(left[frame]));
                rightPeak = Math.max(rightPeak, Math.abs(right[frame]));
                channelDifference = Math.max(channelDifference, Math.abs(left[frame] - right[frame]));
            }
            function toneAmplitude(samples: Float32Array, frequency: number): number {
                let sine = 0;
                let cosine = 0;
                const firstFrame = sampleRate / 20;
                for (let frame = firstFrame; frame < frames; frame++) {
                    const phase = (2 * Math.PI * frequency * frame) / sampleRate;
                    sine += samples[frame] * Math.sin(phase);
                    cosine += samples[frame] * Math.cos(phase);
                }
                return (2 * Math.hypot(sine, cosine)) / (frames - firstFrame);
            }
            return {
                leftPeak,
                rightPeak,
                channelDifference,
                leftOwn: toneAmplitude(left, 1000),
                leftLeak: toneAmplitude(left, 1500),
                rightOwn: toneAmplitude(right, 1500),
                rightLeak: toneAmplitude(right, 1000),
            };
        }

        return {
            autoPanMono: await render('auto-pan', 1),
            widenerMono: await render('widener', 1),
            autoPanStereo: await render('auto-pan', 2, true),
            widenerStereo: await render('widener', 2, true),
            widenerWideStereo: await render('widener', 2),
        };
    });

    expect(result.autoPanMono.leftPeak).toBeGreaterThan(0.1);
    expect(result.autoPanMono.rightPeak).toBeGreaterThan(0.05);
    expect(result.widenerMono.leftPeak).toBeGreaterThan(0.15);
    expect(result.widenerMono.channelDifference).toBeLessThan(0.000001);
    for (const stereo of [result.autoPanStereo, result.widenerStereo]) {
        expect(stereo.leftOwn).toBeGreaterThan(0.17);
        expect(stereo.rightOwn).toBeGreaterThan(0.08);
        expect(stereo.leftLeak).toBeLessThan(0.02);
        expect(stereo.rightLeak).toBeLessThan(0.02);
    }
    expect(result.widenerWideStereo.channelDifference).toBeGreaterThan(0.2);
    expect(result.widenerWideStereo.rightPeak).toBeGreaterThan(0.05);
});
