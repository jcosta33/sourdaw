import { expect, test } from '@playwright/test';

test('mono sources reach both Auto Pan outputs and stay centred through Stereo Widener', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
        const [{ createAutoPan }, { createStereoWidener }, { applyStereoWidenerParams }] = await Promise.all([
            import('/src/modules/AudioEngine/repositories/devices/modulation/createAutoPan.ts'),
            import('/src/modules/AudioEngine/repositories/devices/modulation/createStereoWidener.ts'),
            import('/src/modules/AudioEngine/repositories/devices/modulation/applyStereoWidenerParams.ts'),
        ]);

        const sampleRate = 48_000;
        const frames = sampleRate / 2;

        async function render(kind: 'auto-pan' | 'widener', channels: 1 | 2) {
            const context = new OfflineAudioContext(2, frames, sampleRate);
            const device = kind === 'auto-pan' ? createAutoPan(context) : createStereoWidener(context);
            if (kind === 'widener') {
                applyStereoWidenerParams(device, { 'width-amount': 1.5, 'width-mono-bass': 20 });
            }
            const buffer = context.createBuffer(channels, frames, sampleRate);
            for (let channel = 0; channel < channels; channel++) {
                const data = buffer.getChannelData(channel);
                for (let frame = 0; frame < frames; frame++) {
                    data[frame] =
                        (channel === 0 ? 1 : -0.5) * 0.2 * Math.sin((2 * Math.PI * 1000 * frame) / sampleRate);
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
            return { leftPeak, rightPeak, channelDifference };
        }

        return {
            autoPanMono: await render('auto-pan', 1),
            widenerMono: await render('widener', 1),
            widenerStereo: await render('widener', 2),
        };
    });

    expect(result.autoPanMono.leftPeak).toBeGreaterThan(0.1);
    expect(result.autoPanMono.rightPeak).toBeGreaterThan(0.05);
    expect(result.widenerMono.leftPeak).toBeGreaterThan(0.15);
    expect(result.widenerMono.channelDifference).toBeLessThan(0.000001);
    expect(result.widenerStereo.channelDifference).toBeGreaterThan(0.2);
    expect(result.widenerStereo.rightPeak).toBeGreaterThan(0.05);
});
