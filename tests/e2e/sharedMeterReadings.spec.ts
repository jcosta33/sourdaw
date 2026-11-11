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

async function paintVisibleC4(page: Page): Promise<void> {
    const piano = page.getByLabel('Piano roll editor');
    const viewport = piano.locator('xpath=ancestor::*[contains(@class,"overflow-auto")][1]');
    const c4 = viewport.getByText('C4', { exact: true });
    await expect(c4).toBeAttached();
    for (let attempt = 0; attempt < 8; attempt++) {
        const row = await c4.boundingBox();
        const bounds = await viewport.boundingBox();
        if (!row || !bounds) {
            throw new Error('Piano row or viewport has no bounds');
        }
        const center = row.y + row.height / 2;
        if (center >= bounds.y && center <= bounds.y + bounds.height) {
            break;
        }
        const previous = await viewport.evaluate((element) => element.scrollTop);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.wheel(0, center > bounds.y + bounds.height ? 500 : -500);
        await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).not.toBe(previous);
    }
    const row = await c4.boundingBox();
    const bounds = await viewport.boundingBox();
    const canvas = await piano.boundingBox();
    if (!row || !bounds || !canvas) {
        throw new Error('Visible C4 geometry is unavailable');
    }
    const scrollLeft = await viewport.evaluate((element) => element.scrollLeft);
    const x = canvas.x + 40 - scrollLeft;
    const y = row.y + row.height / 2;
    expect(x).toBeGreaterThanOrEqual(bounds.x);
    expect(x).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(y).toBeGreaterThanOrEqual(bounds.y);
    expect(y).toBeLessThanOrEqual(bounds.y + bounds.height);
    await page.mouse.click(x, y);
    await expect(page.getByTestId('selected-clip-note-count')).toHaveText('1 note');
}

async function observePlayback(page: Page, endBeat: number) {
    return page.evaluate(
        async ({ entry, endBeat }) => {
            const { audio }: typeof import('./persistedHydrationEntry') = await import(entry);
            const analyser = audio.getMasterAnalyser();
            const data = new Float32Array(analyser.fftSize);
            const master = document.querySelector('[data-testid="channel-master"]');
            const hold = master?.querySelector('[title="Click to reset peak"]');
            const meter = master?.querySelector('[role="meter"][aria-label="Level meter"]');
            const playhead = document.querySelector('[data-testid="transport-playhead"]');
            const play = document.querySelector('[data-testid="transport-play"]');
            const out = Array.from(
                document.querySelectorAll('footer[aria-label="Application status"] [aria-hidden="true"]')
            ).find((element) => /^Out\b/.test(element.textContent?.trim() ?? ''));
            if (!analyser || !master || !hold || !meter || !playhead || !play || !out) {
                throw new Error('Required live meter, cursor or status surface is missing');
            }
            const samples: {
                beat: number;
                playing: boolean;
                analyser: number;
                hold: string;
                meter: number;
                out: string;
            }[] = [];
            const deadline = performance.now() + 20_000;
            return new Promise<typeof samples>((resolve, reject) => {
                const tick = (): void => {
                    const position = /^Bars\s*(\d+)\s*\.\s*(\d+)\s*\.\s*(\d+)$/.exec(
                        playhead.textContent?.trim() ?? ''
                    );
                    if (!position) {
                        reject(new Error('Musical cursor is unavailable'));
                        return;
                    }
                    // This fixture proves 4/4 with no meter-map changes. PlayheadDisplay uses 480 display ticks.
                    const beat = (Number(position[1]) - 1) * 4 + Number(position[2]) - 1 + Number(position[3]) / 480;
                    analyser.getFloatTimeDomainData(data);
                    let peak = 0;
                    for (const sample of data) {
                        peak = Math.max(peak, Math.abs(sample));
                    }
                    const meterValue = meter.getAttribute('aria-valuenow');
                    if (meterValue === null || !Number.isFinite(Number(meterValue))) {
                        reject(new Error('Mounted Master meter has no finite announced reading'));
                        return;
                    }
                    samples.push({
                        beat,
                        playing: play.getAttribute('aria-label') === 'Pause',
                        analyser: peak,
                        hold: hold.textContent?.trim() ?? '',
                        meter: Number(meterValue),
                        out: out.textContent?.trim() ?? '',
                    });
                    if (beat > endBeat + 1) {
                        resolve(samples);
                    } else if (performance.now() > deadline) {
                        reject(new Error('Playback did not pass the authenticated clip interval'));
                    } else {
                        requestAnimationFrame(tick);
                    }
                };
                tick();
            });
        },
        { entry: ENTRY, endBeat }
    );
}

function assertLiveReadings(
    samples: Awaited<ReturnType<typeof observePlayback>>,
    startBeat: number,
    endBeat: number
): void {
    const inside = samples.filter((sample) => sample.playing && sample.beat >= startBeat && sample.beat < endBeat);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.some((sample) => sample.analyser > 0.01)).toBe(true);
    expect(inside.some((sample) => sample.meter > -50)).toBe(true);
    expect(
        samples.some(
            (sample) => sample.hold !== '' && Number.isFinite(Number(sample.hold)) && Number(sample.hold) > -50
        )
    ).toBe(true);
    expect(
        inside.some((sample) => {
            const match = /^Out\s*([+-]?\d+(?:\.\d+)?)\s*dB$/.exec(sample.out);
            return match !== null && Number(match[1]) > -50;
        })
    ).toBe(true);
}

test('Mixer Master and Out show real in-clip C4 playback without consuming each other', async ({ page }) => {
    await setupWorkspace(page);
    await launch_new_project(page);
    const response = await page.request.get('/');
    expect(decodeURIComponent(response.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: /^Fermenter/ }).click();
    await expect(page.getByRole('button', { name: 'Close Fermenter', exact: true })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Close Fermenter', exact: true }).click();
    await browser.getByRole('tab', { name: 'Effects', exact: true }).click();
    await browser.getByRole('button', { name: /^Audio FX/ }).click();
    await browser.getByRole('button', { name: /^Dynamics/ }).click();
    await browser.getByRole('button', { name: /^Crust/ }).click();
    await expect(page.getByRole('slider', { name: 'Input gain', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Crust', exact: true }).click();
    const timeline = page.getByLabel('Timeline editor surface');
    await expect(timeline).toBeVisible();
    await timeline.click({ button: 'right', position: { x: 80, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await timeline.dblclick({ position: { x: 80, y: 30 } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
    await page.getByRole('button', { name: 'Toggle paint mode', exact: true }).click();
    await paintVisibleC4(page);
    const music = await page.evaluate(async (entry) => {
        const { arrangement, midi, crdt }: typeof import('./persistedHydrationEntry') = await import(entry);
        const tracks = arrangement.trackStore.value?.tracks;
        const root = crdt.getCrdtDoc<{
            tracks: { tracks: NonNullable<typeof tracks> };
            midi: NonNullable<typeof midi.midiStore.value>;
            transport: { timeSignatureNumerator: number; timeSignatureDenominator: number };
            timeSignatureMap?: unknown;
        }>('root');
        const track = tracks?.find((track) => track.devices.some((device) => device.type === 'fermenter'));
        const clip = track?.clips.find((clip) => clip.type === 'midi');
        if (!track || !clip || !root) {
            throw new Error('The UI-created instrument/clip has no live project authority');
        }
        const meterMap = root.timeSignatureMap;
        let timeSignatureMapChanges: unknown[] = [];
        if (meterMap !== undefined) {
            if (
                typeof meterMap !== 'object' ||
                meterMap === null ||
                !('changes' in meterMap) ||
                !Array.isArray(meterMap.changes)
            ) {
                throw new Error('The raw meter-map shape is not the declared changes record');
            }
            timeSignatureMapChanges = meterMap.changes;
        }
        return {
            track,
            clip,
            notes: midi.midiStore.value?.notesByClipId[clip.id],
            rawTrack: root.tracks.tracks.find((row) => row.id === track.id),
            rawNotes: root.midi.notesByClipId[clip.id],
            transport: root.transport,
            timeSignatureMapPresent: meterMap !== undefined,
            timeSignatureMapChanges,
        };
    }, ENTRY);
    expect(music.rawTrack).toEqual(music.track);
    expect(music.rawNotes).toEqual(music.notes);
    expect(music.track.devices.map((device) => device.type)).toEqual(['fermenter', 'crust']);
    expect(music.clip.endBeat - music.clip.startBeat).toBe(4);
    expect(music.notes).toHaveLength(1);
    const note = music.notes?.[0];
    if (!note) {
        throw new Error('Painted note is unavailable');
    }
    expect(note.pitch).toBe(60);
    expect(note.startBeat).toBeGreaterThanOrEqual(0);
    expect(note.startBeat + note.duration).toBeLessThanOrEqual(4);
    expect(note.duration).toBeGreaterThan(0);
    expect(music.transport.timeSignatureNumerator).toBe(4);
    expect(music.transport.timeSignatureDenominator).toBe(4);
    expect(music.timeSignatureMapChanges).toEqual([]);
    await page.locator('#bottom-dock-tab-mixer').click();
    const mixer = page.getByRole('region', { name: 'Mixer panel', exact: true });
    await expect(mixer).toBeVisible();
    const master = mixer.getByTestId('channel-master');
    const hold = master.getByTitle('Click to reset peak');
    const meter = master.getByRole('meter', { name: 'Level meter', exact: true });
    await expect(hold).toBeVisible();
    await expect(meter).toBeAttached();
    await expect(page.getByTestId('transport-playhead')).toHaveText(/Bars/);
    await page.getByTestId('transport-play').click();
    const first = await observePlayback(page, music.clip.endBeat);
    assertLiveReadings(
        first,
        music.clip.startBeat + note.startBeat,
        music.clip.startBeat + note.startBeat + note.duration
    );
    await page.getByTestId('transport-stop').click();
    await expect(page.getByTestId('transport-playhead')).toHaveText(/Bars1\.1\.000/);
    await expect(meter).toHaveAttribute('aria-valuenow', '-60.0');
    await expect(hold).toHaveText(/^[+-]?\d+\.\d+$/);
    await hold.click();
    await expect(hold).toHaveText('-∞');
    await page.getByTestId('transport-play').click();
    const replay = await observePlayback(page, music.clip.endBeat);
    assertLiveReadings(
        replay,
        music.clip.startBeat + note.startBeat,
        music.clip.startBeat + note.startBeat + note.duration
    );
    await page.getByTestId('transport-stop').click();
    await expect(meter).toHaveAttribute('aria-valuenow', '-60.0');
    console.log('Shared meter evidence', JSON.stringify({ music, first, replay }));
});
