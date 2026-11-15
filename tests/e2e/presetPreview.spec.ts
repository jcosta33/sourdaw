import { test, expect } from './e2eTest';
import { add_midi_track, launch_new_project, setupWorkspace } from './e2eUtils';

import type { ProjectInspectionModule } from './directProjectSetupContract';

type PreviewPcm = { sampleRate: number; channels: Float32Array[] };

declare global {
    interface Window {
        presetPreviewStarts: PreviewPcm[];
    }
}

test.describe('Preset sound audition', () => {
    test('plays real preset PCM while preserving the live project and complete history', async ({ page }) => {
        await page.addInitScript(() => {
            window.presetPreviewStarts = [];
            const nativeStart = AudioBufferSourceNode.prototype.start;
            AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args): void {
                nativeStart.apply(this, args);
                // Offline scheduling is not evidence that the preview reached live playback.
                const buffer = this.buffer;
                if (this.context instanceof AudioContext && buffer !== null) {
                    window.presetPreviewStarts.push({
                        sampleRate: buffer.sampleRate,
                        channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
                            buffer.getChannelData(channel).slice()
                        ),
                    });
                }
            };
        });
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_midi_track(page);
        const visibleTrackId = (
            await page.locator('[data-testid^="track-mute-"]').first().getAttribute('data-testid')
        )?.slice('track-mute-'.length);
        expect(visibleTrackId).toBeTruthy();
        const inspect = () =>
            page.evaluate(async () => {
                const entryPath = '/e2e/direct-project-setup.js';
                const entry: ProjectInspectionModule = await import(entryPath);
                return entry.inspectProject();
            });
        await expect.poll(async () => (await inspect()).history.past.length).toBe(1);
        const baseline = await inspect();
        expect(baseline.project).toEqual(
            expect.objectContaining({
                tracks: expect.objectContaining({
                    tracks: expect.arrayContaining([expect.objectContaining({ id: visibleTrackId })]),
                }),
            })
        );
        expect(baseline.history.past[0]).toEqual(
            expect.objectContaining({
                kind: 'action',
                action: expect.objectContaining({
                    type: 'addTrack',
                    payload: expect.objectContaining({ id: visibleTrackId }),
                }),
                inverseAction: expect.objectContaining({
                    type: 'discardCreatedTrack',
                    payload: expect.objectContaining({ trackId: visibleTrackId }),
                }),
            })
        );
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await expect(browser).toBeVisible();
        await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
        const measurements: Array<{
            name: string;
            sampleRate: number;
            channels: number;
            frames: number;
            finite: boolean;
            energy: number;
            attackFraction: number;
            lateFraction: number;
            postPhraseFraction: number;
            lowFraction: number;
            highFraction: number;
            roughness: number;
        }> = [];
        for (const [index, name] of ['Acid Bass', 'Warm Pad', 'Plate Reverb', 'Vocal Presence EQ'].entries()) {
            if (index === 2) {
                await browser.getByRole('tab', { name: 'Effects', exact: true }).click();
            }
            await browser.getByRole('searchbox', { name: 'Search browser' }).fill(name);
            await browser.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
            await expect
                .poll(() => page.evaluate(() => window.presetPreviewStarts.length), {
                    message: 'Preset gesture must start a real buffer on the existing live AudioContext',
                })
                .toBe(index + 1);
            const pcm = await page.evaluate((startIndex) => {
                const start = window.presetPreviewStarts[startIndex];
                if (!start) {
                    throw new Error('No live preset buffer started');
                }
                let energy = 0;
                let attack = 0;
                let late = 0;
                let postPhrase = 0;
                let lowEnergy = 0;
                let highEnergy = 0;
                let differenceEnergy = 0;
                let finite = true;
                const lowAlpha = 1 - Math.exp((-2 * Math.PI * 180) / start.sampleRate);
                const highAlpha = 1 - Math.exp((-2 * Math.PI * 1500) / start.sampleRate);
                for (const channel of start.channels) {
                    let low = 0;
                    let highLowPass = 0;
                    let previous = 0;
                    for (const [frame, sample] of channel.entries()) {
                        finite = finite && Number.isFinite(sample);
                        const squared = sample * sample;
                        energy += squared;
                        if (frame < start.sampleRate * 0.25) {
                            attack += squared;
                        }
                        if (frame >= start.sampleRate * 2) {
                            postPhrase += squared;
                        }
                        if (frame >= start.sampleRate * 3.5) {
                            late += squared;
                        }
                        low += lowAlpha * (sample - low);
                        highLowPass += highAlpha * (sample - highLowPass);
                        lowEnergy += low * low;
                        highEnergy += (sample - highLowPass) ** 2;
                        differenceEnergy += (sample - previous) ** 2;
                        previous = sample;
                    }
                }
                return {
                    sampleRate: start.sampleRate,
                    channels: start.channels.length,
                    frames: start.channels[0]?.length ?? 0,
                    finite,
                    energy,
                    attackFraction: attack / energy,
                    lateFraction: late / energy,
                    postPhraseFraction: postPhrase / energy,
                    lowFraction: lowEnergy / energy,
                    highFraction: highEnergy / energy,
                    roughness: differenceEnergy / energy,
                };
            }, index);
            measurements.push({ name, ...pcm });
            expect(pcm.sampleRate).toBeGreaterThan(0);
            expect(pcm.channels).toBe(2);
            expect(pcm.frames).toBe(pcm.sampleRate * 6);
            expect(pcm.finite).toBe(true);
            expect(pcm.energy).toBeGreaterThan(0);
            await browser.getByRole('button', { name: `Stop previewing ${name}`, exact: true }).click();
            expect(await inspect()).toEqual(baseline);
        }
        console.log('Preset PCM measurements:', JSON.stringify(measurements));
        const [acid, pad, plate, eq] = measurements;
        if (!acid || !pad || !plate || !eq) {
            throw new Error('All four real catalog previews are required');
        }
        // Broad margins from real output: envelope and normalized spectral slope both distinguish patches.
        expect(acid.attackFraction).toBeGreaterThan(pad.attackFraction * 4);
        expect(acid.roughness).toBeGreaterThan(pad.roughness * 1.5);
        // Both FX previews use the same phrase; only the processed Plate rings beyond its 2s extent.
        expect(plate.postPhraseFraction).toBeGreaterThan(0.0001);
        expect(eq.postPhraseFraction).toBeLessThan(0.000001);
        expect(plate.highFraction).toBeLessThan(eq.highFraction * 0.8);

        await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
        expect(await inspect()).toEqual(baseline);
    });
});
