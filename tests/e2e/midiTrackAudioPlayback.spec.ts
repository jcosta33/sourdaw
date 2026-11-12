import { realpathSync } from 'node:fs';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

import { type Page } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const ENTRY = isBuiltE2eShardRun(env) ? '/e2e/persisted-hydration.js' : '/tests/e2e/persistedHydrationEntry.ts';

test.use({ viewport: { width: 1600, height: 1000 } });

function musicalWav(): Buffer {
    const sampleRate = 44_100;
    const frames = sampleRate * 3;
    const wav = Buffer.alloc(44 + frames * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + frames * 2, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(frames * 2, 40);
    for (let frame = 0; frame < frames; frame += 1) {
        wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 317 * frame) / sampleRate) * 12_000), 44 + frame * 2);
    }
    return wav;
}

async function projectSnapshot(page: Page) {
    return page.evaluate(async (entry) => {
        const { arrangement, command, crdt }: typeof import('./persistedHydrationEntry') = await import(entry);
        return {
            root: crdt.getCrdtDoc('root'),
            tracks: arrangement.trackStore.value?.tracks,
            history: command.captureUndoHistory(),
        };
    }, ENTRY);
}

async function observeSignal(page: Page, mode: 'first' | 'loop') {
    return page.evaluate(
        async ({ entry, mode }) => {
            const { audio }: typeof import('./persistedHydrationEntry') = await import(entry);
            const analyser = audio.getMasterAnalyser();
            const context = audio.getAudioContext();
            const cursor = document.querySelector('[data-testid="transport-playhead"]');
            const play = document.querySelector('[data-testid="transport-play"]');
            if (!analyser || !cursor || !play) {
                throw new Error('Required master analyser or transport surface is missing');
            }
            const samples = new Float32Array(analyser.fftSize);
            const deadline = performance.now() + 20_000;
            let previousBeat = 0;
            let firstPeak = 0;
            let beforeWrapPeak = 0;
            let afterWrapPeak = 0;
            let wrapped = false;
            let outgoingBeat = 0;
            let incomingBeat = 0;
            return new Promise<{
                contextState: AudioContextState;
                firstPeak: number;
                beforeWrapPeak: number;
                afterWrapPeak: number;
                wrapped: boolean;
                outgoingBeat: number;
                incomingBeat: number;
            }>((resolve, reject) => {
                const tick = (): void => {
                    const position = /^Bars\s*(\d+)\s*\.\s*(\d+)\s*\.\s*(\d+)$/.exec(cursor.textContent?.trim() ?? '');
                    if (!position) {
                        reject(new Error('Musical cursor is unavailable'));
                        return;
                    }
                    // A fresh project is 4/4; PlayheadDisplay uses 480 display ticks per beat.
                    const beat = (Number(position[1]) - 1) * 4 + Number(position[2]) - 1 + Number(position[3]) / 480;
                    analyser.getFloatTimeDomainData(samples);
                    let peak = 0;
                    for (const sample of samples) {
                        peak = Math.max(peak, Math.abs(sample));
                    }
                    const playing = play.getAttribute('aria-label') === 'Pause';
                    if (playing && context.state === 'running') {
                        if (beat > 0.2 && beat < 1.5) {
                            firstPeak = Math.max(firstPeak, peak);
                        }
                        if (beat > 5 && beat < 6) {
                            beforeWrapPeak = Math.max(beforeWrapPeak, peak);
                        }
                        if (mode === 'loop' && previousBeat > 5 && beat < 1) {
                            wrapped = true;
                            outgoingBeat = previousBeat;
                            incomingBeat = beat;
                        }
                        if (wrapped && beat > 0.1 && beat < 1) {
                            afterWrapPeak = Math.max(afterWrapPeak, peak);
                        }
                    }
                    previousBeat = beat;
                    const complete = mode === 'first' ? beat >= 1.5 : wrapped && beat >= 1 && afterWrapPeak > 0;
                    if (complete) {
                        resolve({
                            contextState: context.state,
                            firstPeak,
                            beforeWrapPeak,
                            afterWrapPeak,
                            wrapped,
                            outgoingBeat,
                            incomingBeat,
                        });
                    } else if (performance.now() > deadline) {
                        reject(new Error('Playback did not produce the required natural loop observations'));
                    } else {
                        requestAnimationFrame(tick);
                    }
                };
                tick();
            });
        },
        { entry: ENTRY, mode }
    );
}

async function expectStoppedSilence(page: Page): Promise<void> {
    await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', 'Play');
    await expect
        .poll(async () =>
            page.evaluate(async (entry) => {
                const { audio }: typeof import('./persistedHydrationEntry') = await import(entry);
                const analyser = audio.getMasterAnalyser();
                if (!analyser) {
                    throw new Error('Master analyser is missing after Stop');
                }
                const samples = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(samples);
                return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
            }, ENTRY)
        )
        .toBe(0);
}

test('MIDI-track Import Audio reaches Master during Play and on both sides of a natural loop wrap', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    const response = await page.request.get('/');
    expect(decodeURIComponent(response.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);

    await page.getByRole('button', { name: 'MIDI Keys & synths' }).click();
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const menu = page.getByRole('menuitem', { name: /Import Audio/i });
    await expect(menu).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await menu.click();
    await (await chooser).setFiles({ name: 'midi-track-audio.wav', mimeType: 'audio/wav', buffer: musicalWav() });

    await expect
        .poll(async () =>
            page.evaluate(async (entry) => {
                const { arrangement, audio, crdt }: typeof import('./persistedHydrationEntry') = await import(entry);
                const projected = arrangement.trackStore.value?.tracks.find((track) => track.kind === 'midi');
                const clip = projected?.clips.find((candidate) => candidate.type === 'audio');
                const raw = crdt.getCrdtDoc<{ tracks: NonNullable<typeof arrangement.trackStore.value> }>('root');
                return Boolean(
                    projected &&
                    clip?.audioBufferId &&
                    raw?.tracks.tracks
                        .find((track) => track.id === projected.id)
                        ?.clips.some((item) => item.id === clip.id) &&
                    audio.getCachedAudioBuffer({ bufferId: clip.audioBufferId })
                );
            }, ENTRY)
        )
        .toBe(true);

    const imported = await page.evaluate(async (entry) => {
        const { arrangement, audio }: typeof import('./persistedHydrationEntry') = await import(entry);
        const track = arrangement.trackStore.value?.tracks.find((candidate) => candidate.kind === 'midi');
        const clip = track?.clips.find((candidate) => candidate.type === 'audio');
        const buffer = clip?.audioBufferId ? audio.getCachedAudioBuffer({ bufferId: clip.audioBufferId }) : null;
        return {
            track,
            clip,
            frames: buffer?.length,
            sampleRate: buffer?.sampleRate,
            channels: buffer?.numberOfChannels,
        };
    }, ENTRY);
    expect(imported.track?.kind).toBe('midi');
    expect(imported.clip?.type).toBe('audio');
    expect(imported.clip?.startBeat).toBe(0);
    expect(imported.clip?.endBeat).toBeCloseTo(6, 1);
    expect(imported.frames).toBe(144_000);
    expect(imported.sampleRate).toBe(48_000);
    expect(imported.channels).toBe(1);

    await expect(page.getByTestId('transport-playhead')).toHaveText(/Bars/);
    const ordinaryBaseline = await projectSnapshot(page);
    await page.getByTestId('transport-play').click();
    const ordinary = await observeSignal(page, 'first');
    expect(ordinary.contextState).toBe('running');
    expect(ordinary.firstPeak).toBeGreaterThan(0.01);
    await page.getByTestId('transport-stop').click();
    await expectStoppedSilence(page);
    const ordinaryAfter = await projectSnapshot(page);
    expect(ordinaryAfter).toEqual(ordinaryBaseline);

    const ruler = page.getByLabel('Beat ruler');
    await expect(ruler).toBeVisible();
    const bounds = await ruler.boundingBox();
    if (!bounds) {
        throw new Error('Beat ruler has no bounds');
    }
    // The fresh timeline has 12 pixels/beat and zero horizontal scroll: this Shift-drag commits 0–6.
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(bounds.x + 0.5, y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(bounds.x + 71.5, y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('transport-loop')).toHaveAttribute('aria-pressed', 'true');
    const baseline = await projectSnapshot(page);
    expect(baseline.root).toHaveProperty('transport.loopStart', 0);
    expect(baseline.root).toHaveProperty('transport.loopEnd', 6);
    await page.getByTestId('transport-play').click();
    const repeated = await observeSignal(page, 'loop');
    expect(repeated.contextState).toBe('running');
    expect(repeated.wrapped).toBe(true);
    expect(repeated.outgoingBeat).toBeGreaterThan(5);
    expect(repeated.incomingBeat).toBeLessThan(1);
    expect(repeated.beforeWrapPeak).toBeGreaterThan(0.01);
    expect(repeated.afterWrapPeak).toBeGreaterThan(0.01);
    await page.getByTestId('transport-stop').click();
    await expectStoppedSilence(page);
    const loopAfter = await projectSnapshot(page);
    expect(loopAfter).toEqual(baseline);
    await testInfo.attach('midi-track-audio-playback-evidence', {
        body: JSON.stringify({ imported, ordinary, repeated, ordinaryBaseline, ordinaryAfter, baseline, loopAfter }),
        contentType: 'application/json',
    });
});
