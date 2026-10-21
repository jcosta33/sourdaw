import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { stringify } from 'superjson';

import type { AppAction } from '../../src/utils/handlerContract';

import { enable_direct_e2e_viewport, launch_new_project } from './e2eUtils';

const RATE = 44_100;
const SOURCE_SECONDS = 13;
const NAME = 'tempo-source-phrase';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const BOOT_TIMEOUT = 90_000;
const LEGACY_PLAYBACK_RATE = 1;
const LEGACY_SECONDS_PER_BEAT = 60 / 60;
// detectOnsets uses 1024-source-frame windows and 512-source-frame hops.
const DETECTOR_BEAT_TOLERANCE = (1024 + 512) / RATE / LEGACY_PLAYBACK_RATE / LEGACY_SECONDS_PER_BEAT;

type Fixture = {
    trackId: string;
    trackName: string;
    clipId: string;
    bufferId: string;
    assetHash?: string;
    projectId: string;
};
type Start = { when: number; offset: number; duration: number; rate: number };
type Observer = { starts: Start[]; restore: () => void };
type ObservedWindow = Window & { __tempoAcceptanceObserver?: Observer };
type Probe = { name: string; songSecond: number; sourceSecond: number; rate: number };
const LOOP_PROBES: Probe[] = [
    { name: 'pre-seam source 9.25', songSecond: 3.5, sourceSecond: 9.25, rate: 1.5 },
    { name: 'reset source 5.5', songSecond: 4, sourceSecond: 5.5, rate: 1.5 },
    { name: 'post-seam source 6.25', songSecond: 4.5, sourceSecond: 6.25, rate: 1.5 },
];

// Independent input PCM: the expected phrase is known before the app imports it.
// The quiet chirp identifies source time without becoming a Strip Silence region.
function inputSample(time: number): number {
    let value = 0.0005 * Math.sin(2 * Math.PI * (80 * time + 7 * time * time));
    for (const [start, frequency] of [
        [6.25, 523],
        [9.25, 997],
        [10.75, 1451],
    ]) {
        if (time >= start && time < start + 0.3) {
            value += 0.6 * Math.sin(2 * Math.PI * frequency * (time - start));
        }
    }
    return Math.round(value * 32767) / 32768;
}

function wavFixture(): Buffer {
    const frames = SOURCE_SECONDS * RATE;
    const bytes = Buffer.alloc(44 + frames * 2);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(RATE, 24);
    bytes.writeUInt32LE(RATE * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(frames * 2, 40);
    for (let frame = 0; frame < frames; frame++)
        bytes.writeInt16LE(Math.round(inputSample(frame / RATE) * 32768), 44 + frame * 2);
    return bytes;
}

async function palette(page: Page, name: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(name);
    const option = page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) });
    await expect(option).toBeVisible();
    await option.click();
}

async function waitProject(page: Page, expectedId?: string): Promise<string> {
    await expect
        .poll(
            async () =>
                page.evaluate(async () => {
                    const { projectStore } = await import('/src/modules/Project/stores/index.ts');
                    const state = projectStore.value;
                    return state?.initialized === true &&
                        state.loading === false &&
                        state.identityMigrationPending !== true &&
                        state.identityPersistencePending !== true
                        ? (state.projectId ?? null)
                        : null;
                }),
            { timeout: BOOT_TIMEOUT, message: 'A settled, initialized production project must own this document' }
        )
        .toEqual(expectedId ?? expect.any(String));
    return page.evaluate(async () => {
        const { projectStore } = await import('/src/modules/Project/stores/index.ts');
        const id = projectStore.value?.projectId;
        if (!id) throw new Error('Initialized project has no durable identity');
        return id;
    });
}

async function boot(page: Page): Promise<string> {
    await enable_direct_e2e_viewport(page);
    await page.addInitScript((dismissed) => {
        // UI-only preferences; deliberately no localStorage.clear, including on reload.
        localStorage.setItem('wd:onboarding-completed', '1');
        localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        localStorage.setItem('wd:first-load-hint-shown', '1');
        Reflect.deleteProperty(window, 'showSaveFilePicker');
    }, stringify(true));
    const capabilities = page.waitForEvent('console', {
        predicate: (message) => message.text().includes('[capabilities]'),
        timeout: BOOT_TIMEOUT,
    });
    await page.goto('/');
    await capabilities;
    await launch_new_project(page);
    return waitProject(page);
}

async function action(page: Page, value: AppAction): Promise<void> {
    const committed = await page.evaluate(async (input) => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        let committed = false;
        await executeAppAction(input, {
            source: 'manual',
            onCommitted: () => {
                committed = true;
            },
        });
        return committed;
    }, value);
    expect(committed, `Production action ${value.type} must commit`).toBe(true);
}

async function clips(page: Page, trackId: string) {
    return page.evaluate(async (id) => {
        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
        return trackStore.value?.tracks.find((track) => track.id === id)?.clips ?? [];
    }, trackId);
}

async function importFixture(page: Page): Promise<Fixture> {
    const projectId = await boot(page);
    await palette(page, 'Add Audio Track');
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .first();
    await row.click({ button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (await chooser).setFiles({ name: `${NAME}.wav`, mimeType: 'audio/wav', buffer: wavFixture() });
    await expect
        .poll(
            async () =>
                page.evaluate(async (name) => {
                    const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
                    return (
                        trackStore.value?.tracks.flatMap((track) => track.clips).filter((clip) => clip.name === name)
                            .length ?? 0
                    );
                }, NAME),
            { timeout: 30_000 }
        )
        .toBe(1);
    const imported = await page.evaluate(async (name) => {
        const [arrangement, audio] = await Promise.all([
            import('/src/modules/Arrangement/stores/index.ts'),
            import('/src/modules/AudioEngine/useCases/index.ts'),
        ]);
        const track = arrangement.trackStore.value?.tracks.find((candidate) =>
            candidate.clips.some((clip) => clip.name === name)
        );
        const clip = track?.clips.find((candidate) => candidate.name === name);
        if (!track || !clip?.audioBufferId) throw new Error('Normal UI import did not publish an audio clip');
        const buffer = audio.getCachedAudioBuffer({ bufferId: clip.audioBufferId });
        if (!buffer || Math.abs(buffer.duration - 13) > 1 / buffer.sampleRate)
            throw new Error('UI import did not decode the expected real PCM');
        return {
            trackId: track.id,
            trackName: track.name,
            clipId: clip.id,
            bufferId: clip.audioBufferId,
            assetHash: clip.assetHash,
        };
    }, NAME);
    const fixture = { ...imported, projectId };
    // The trim produces canonical 5.5 seconds through its ordinary handler.
    // Repitch changes geometry, so the final end is set after the ratio.
    const setup: AppAction[] = [
        { type: 'trimClipStart', payload: { clipId: fixture.clipId, newStartBeat: 11 } },
        { type: 'moveClip', payload: { clipId: fixture.clipId, trackId: fixture.trackId, startBeat: 2 } },
        { type: 'setClipStretchMode', payload: { clipId: fixture.clipId, mode: 'repitch' } },
        { type: 'setClipStretchRatio', payload: { clipId: fixture.clipId, ratio: 1.5 } },
        { type: 'trimClipEnd', payload: { clipId: fixture.clipId, newEndBeat: 8 } },
        { type: 'setClipLoopLength', payload: { clipId: fixture.clipId, loopLength: 4 } },
        { type: 'setClipLoop', payload: { clipId: fixture.clipId, enabled: true } },
    ];
    for (const item of setup) await action(page, item);
    await expect(page.getByRole('button', { name: 'Toggle tempo map', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Toggle tempo map', exact: true }).click();
    // The first map event governs earlier beats too, so name both endpoints.
    for (const change of [
        { beat: 0, tempo: 120 },
        { beat: 4, tempo: 60 },
    ]) {
        await page.getByRole('spinbutton', { name: 'New tempo change beat', exact: true }).fill(String(change.beat));
        await page.getByRole('spinbutton', { name: 'New tempo change BPM', exact: true }).fill(String(change.tempo));
        await page.getByRole('combobox', { name: 'New tempo change curve type', exact: true }).selectOption('instant');
        await page.getByRole('button', { name: 'Add tempo change', exact: true }).click();
    }
    await expect
        .poll(async () =>
            page.evaluate(async () => {
                const { tempoMapStore } = await import('/src/modules/Transport/stores/index.ts');
                return tempoMapStore.value?.changes.map(({ beat, tempo }) => ({ beat, tempo }));
            })
        )
        .toContainEqual({ beat: 4, tempo: 60 });
    await page.getByRole('button', { name: 'Toggle tempo map', exact: true }).click();
    expect((await clips(page, fixture.trackId))[0]).toMatchObject({
        startBeat: 2,
        endBeat: 8,
        audioOffsetSeconds: 5.5,
        audioLoopStartSeconds: 5.5,
        stretchRatio: 1.5,
        loopOriginBeat: 2,
    });
    return fixture;
}

function trackRow(page: Page, fixture: Fixture) {
    return (
        page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .filter({ has: page.getByText(fixture.trackName, { exact: true }) })
            // TrackListView also wraps this full-height header in a role=row.
            .filter({ hasNot: page.getByRole('row') })
    );
}

async function clipPoint(page: Page, fixture: Fixture, beat: number): Promise<{ x: number; y: number }> {
    const geometry = await page.evaluate(
        async ({ id, beat }) => {
            const { timelineViewStore, trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
            const view = timelineViewStore.value;
            if (!view) throw new Error('Timeline view is not initialized');
            const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
            if (!track) throw new Error('Imported track disappeared');
            return { x: beat * view.pixelsPerBeat - view.scrollX };
        },
        { id: fixture.trackId, beat }
    );
    const canvasBox = await page.getByLabel('Timeline editor surface').boundingBox();
    const muteBox = await trackRow(page, fixture)
        .getByRole('button', { name: `Mute ${fixture.trackName}`, exact: true })
        .boundingBox();
    if (!canvasBox || !muteBox) throw new Error('Track row and actual timeline canvas must be visible');
    return { x: geometry.x, y: muteBox.y - canvasBox.y + muteBox.height / 2 };
}

async function clipMenu(page: Page, fixture: Fixture, beat: number, item: string): Promise<void> {
    await page
        .getByLabel('Timeline editor surface')
        .click({ button: 'right', position: await clipPoint(page, fixture, beat) });
    await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function splitUi(page: Page, fixture: Fixture): Promise<string> {
    await clipMenu(page, fixture, 4, 'Split at Cursor');
    await expect.poll(async () => (await clips(page, fixture.trackId)).length).toBe(2);
    const right = (await clips(page, fixture.trackId)).find((clip) => clip.startBeat === 4);
    if (!right) throw new Error('UI split did not produce the expected right fragment');
    expect(right).toMatchObject({ audioOffsetSeconds: 7, audioLoopStartSeconds: 5.5, loopOriginBeat: 2 });
    return right.id;
}

async function exportPcm(page: Page, info: TestInfo, label: string, probes = LOOP_PROBES): Promise<void> {
    await page.keyboard.press(`${MOD}+Shift+e`);
    const dialog = page.getByRole('dialog').filter({ hasText: 'The Bakery' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Whole project', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'As mixed', exact: true }).click();
    await dialog.getByRole('button', { name: '44.1k', exact: true }).click();
    await dialog.getByRole('button', { name: '24-bit', exact: true }).click();
    const autoTail = dialog.getByRole('checkbox', { name: 'Auto-detect', exact: true });
    if (await autoTail.isChecked()) await autoTail.uncheck();
    await dialog.getByLabel('Tail seconds', { exact: true }).fill('0');
    const pending = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const file = await download.path();
    if (!file) throw new Error('Actual export did not retain a downloaded WAV');
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    const samples = await page.evaluate(
        async ({ encoded, probes }) => {
            const { audioEngine } = await import('/src/modules/AudioEngine/useCases/index.ts');
            const binary = atob(encoded);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            const buffer = await audioEngine.context.decodeAudioData(bytes.buffer);
            return probes.map((probe) => {
                const start = Math.round((probe.songSecond + 0.035) * buffer.sampleRate);
                const end = start + Math.round(0.08 * buffer.sampleRate);
                if (end > buffer.length) throw new Error('Export ended before the required phrase probe');
                return {
                    name: probe.name,
                    rate: buffer.sampleRate,
                    startSecond: start / buffer.sampleRate,
                    samples: Array.from(buffer.getChannelData(0).subarray(start, end)),
                };
            });
        },
        { encoded: bytes.toString('base64'), probes }
    );
    const evidence = samples.map((window, index) => {
        const probe = probes[index];
        let best = -1;
        for (let lag = -2; lag <= 2; lag++) {
            let dot = 0,
                expectedPower = 0,
                actualPower = 0;
            for (let frame = 0; frame < window.samples.length; frame++) {
                const source =
                    probe.sourceSecond +
                    (window.startSecond - probe.songSecond + (frame + lag) / window.rate) * probe.rate;
                const expected = inputSample(source);
                const actual = window.samples[frame];
                dot += actual * expected;
                expectedPower += expected * expected;
                actualPower += actual * actual;
            }
            best = Math.max(best, dot / Math.sqrt(expectedPower * actualPower));
        }
        expect(best, `${label}: downloaded PCM must contain ${probe.name}`).toBeGreaterThan(0.95);
        return { ...probe, correlation: best };
    });
    await info.attach(`${label}-pcm-probes`, { body: JSON.stringify(evidence), contentType: 'application/json' });
    await info.attach(`${label}-actual-export`, { path: file, contentType: 'audio/wav' });
    await dialog.getByRole('button', { name: 'Close Bakery', exact: true }).click();
}

async function realPlayback(page: Page, fixture: Fixture, info: TestInfo, label: string): Promise<void> {
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.evaluate(async ({ bufferId }) => {
        const { audioEngine, getCachedAudioBuffer } = await import('/src/modules/AudioEngine/useCases/index.ts');
        const buffer = getCachedAudioBuffer({ bufferId });
        if (!buffer) throw new Error('Real imported buffer is unavailable for live observation');
        const global = window as ObservedWindow;
        global.__tempoAcceptanceObserver?.restore();
        const original = AudioBufferSourceNode.prototype.start;
        const starts: Start[] = [];
        AudioBufferSourceNode.prototype.start = function (
            this: AudioBufferSourceNode,
            when = 0,
            offset = 0,
            duration?: number
        ) {
            if (duration === undefined) original.call(this, when, offset);
            else original.call(this, when, offset, duration);
            if (this.context === audioEngine.context && this.buffer === buffer) {
                starts.push({
                    when,
                    offset,
                    duration: duration ?? buffer.duration - offset,
                    rate: this.playbackRate.value,
                });
            }
        };
        global.__tempoAcceptanceObserver = {
            starts,
            restore: () => {
                AudioBufferSourceNode.prototype.start = original;
            },
        };
    }, fixture);
    try {
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await expect
            .poll(
                async () =>
                    page.evaluate(async () => {
                        const { audioEngine } = await import('/src/modules/AudioEngine/useCases/index.ts');
                        const values = new Float32Array(audioEngine.masterAnalyser.fftSize);
                        audioEngine.masterAnalyser.getFloatTimeDomainData(values);
                        return {
                            running: audioEngine.context.state,
                            rms: Math.sqrt(values.reduce((sum, sample) => sum + sample * sample, 0) / values.length),
                        };
                    }),
                { timeout: 12_000 }
            )
            .toMatchObject({ running: 'running', rms: expect.any(Number) });
        await expect
            .poll(
                async () =>
                    page.evaluate(async () => {
                        const { audioEngine } = await import('/src/modules/AudioEngine/useCases/index.ts');
                        const values = new Float32Array(audioEngine.masterAnalyser.fftSize);
                        audioEngine.masterAnalyser.getFloatTimeDomainData(values);
                        return Math.sqrt(values.reduce((sum, sample) => sum + sample * sample, 0) / values.length);
                    }),
                { timeout: 12_000 }
            )
            .toBeGreaterThan(0.00001);
        await expect
            .poll(
                async () =>
                    page.evaluate(async () => {
                        const { playheadPositionRef } = await import('/src/modules/Transport/stores/index.ts');
                        return playheadPositionRef.current;
                    }),
                { timeout: 15_000 }
            )
            .toBeGreaterThan(7);
        const starts = await page.evaluate(() => (window as ObservedWindow).__tempoAcceptanceObserver?.starts ?? []);
        expect(starts.length).toBeGreaterThanOrEqual(2);
        const first = starts.reduce((left, right) => (left.when < right.when ? left : right));
        expect(first.offset).toBeCloseTo(5.5, 6);
        const origin = first.when - 1; // The fixture clip begins at beat2/song second1.
        for (const probe of LOOP_PROBES) {
            const node = starts.find(
                (entry) =>
                    entry.when - origin <= probe.songSecond + 1e-6 &&
                    probe.songSecond < entry.when - origin + entry.duration / entry.rate - 1e-6
            );
            if (!node) throw new Error(`No actually started live source covers ${probe.name}`);
            expect(node.offset + (probe.songSecond - (node.when - origin)) * node.rate).toBeCloseTo(
                probe.sourceSecond,
                4
            );
        }
        expect(
            starts.some((node) => Math.abs(node.when - origin - 4) < 1e-4 && Math.abs(node.offset - 5.5) < 1e-4)
        ).toBe(true);
        await info.attach(`${label}-real-start-calls`, {
            body: JSON.stringify({ origin, starts }),
            contentType: 'application/json',
        });
    } finally {
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        await page.evaluate(() => {
            (window as ObservedWindow).__tempoAcceptanceObserver?.restore();
        });
    }
}

async function assertWaveformPixels(
    page: Page,
    fixture: Fixture,
    info: TestInfo,
    label: string,
    controls: { startBeat: number; baselineBeat: number }[]
): Promise<void> {
    const canvas = page.getByLabel('Timeline editor surface');
    const screenshot = await canvas.screenshot();
    await info.attach(`${label}-actual-waveform`, { body: screenshot, contentType: 'image/png' });
    const point = await clipPoint(page, fixture, 0);
    const metrics = await page.evaluate(
        async ({ encoded, centerY, controls }) => {
            const { timelineViewStore } = await import('/src/modules/Arrangement/stores/index.ts');
            const view = timelineViewStore.value;
            if (!view) throw new Error('Visible timeline lost its view geometry');
            const image = await createImageBitmap(
                new Blob([Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))], {
                    type: 'image/png',
                })
            );
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Cannot inspect the real rendered screenshot');
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, image.width, image.height).data;
            const surface = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Timeline editor surface"]');
            if (!surface) throw new Error('The screenshot must belong to the actual timeline canvas');
            const scale = image.width / surface.getBoundingClientRect().width;
            const y = Math.round((centerY + 4) * scale);
            const luminance = (x: number, row: number) => {
                const at = (row * image.width + x) * 4;
                return (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3;
            };
            const columnEnergy = (beat: number, baselineBeat: number) => {
                const x = Math.round((beat * view.pixelsPerBeat - view.scrollX + 4) * scale);
                const baselineX = Math.round((baselineBeat * view.pixelsPerBeat - view.scrollX + 4) * scale);
                let energy = 0;
                for (let dy = Math.round(4 * scale); dy <= Math.round(12 * scale); dy++) {
                    energy += Math.max(0, luminance(x, y - dy) - luminance(baselineX, y - dy));
                    energy += Math.max(0, luminance(x, y + dy) - luminance(baselineX, y + dy));
                }
                return energy;
            };
            const median = (values: number[]) =>
                [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
            return controls.map(({ startBeat, baselineBeat }) => ({
                startBeat,
                // A burst occupies a window, whereas a grid line can affect one column.
                energy: median(
                    Array.from({ length: 9 }, (_, index) => columnEnergy(startBeat + index * 0.025, baselineBeat))
                ),
                quietNoise: median(
                    Array.from({ length: 9 }, (_, index) => columnEnergy(baselineBeat + index * 0.025, baselineBeat))
                ),
            }));
        },
        {
            encoded: screenshot.toString('base64'),
            centerY: point.y,
            controls,
        }
    );
    for (const metric of metrics)
        expect(
            metric.energy,
            `Actual waveform ink must mark the independent source burst near beat ${metric.startBeat}`
        ).toBeGreaterThan(8 + metric.quietNoise * 4);
    await info.attach(`${label}-waveform-pixel-evidence`, {
        body: JSON.stringify(metrics),
        contentType: 'application/json',
    });
}

async function saveReload(
    page: Page,
    fixture: Fixture,
    expectedClipCount = 2,
    beforeReload?: () => Promise<void>
): Promise<void> {
    await palette(page, 'Save Project');
    await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0, { timeout: 30_000 });
    await beforeReload?.();
    const capabilities = page.waitForEvent('console', {
        predicate: (message) => message.text().includes('[capabilities]'),
        timeout: BOOT_TIMEOUT,
    });
    await page.reload();
    await capabilities;
    // The normal boot may reopen the last project, or offer it on the launch screen.
    // Both paths must finish on the exact saved identity; no state or session mirror is injected.
    const recent = page
        .getByLabel('Sourdaw — start a project')
        .getByRole('button', { name: 'Open recent project Untitled Project', exact: true });
    let bootRoute = 'pending';
    await expect
        .poll(
            async () => {
                const restored = await page.evaluate(async (id) => {
                    const { projectStore } = await import('/src/modules/Project/stores/index.ts');
                    const state = projectStore.value;
                    return (
                        state?.initialized === true &&
                        state.loading === false &&
                        state.projectId === id &&
                        state.identityMigrationPending !== true &&
                        state.identityPersistencePending !== true
                    );
                }, fixture.projectId);
                bootRoute = restored ? 'restored' : (await recent.isVisible()) ? 'recent' : 'pending';
                return bootRoute;
            },
            { timeout: BOOT_TIMEOUT }
        )
        .toMatch(/^(restored|recent)$/);
    if (bootRoute === 'recent') await recent.click();
    await waitProject(page, fixture.projectId);
    await expect
        .poll(async () => (await clips(page, fixture.trackId)).length, { timeout: 30_000 })
        .toBe(expectedClipCount);
}

type SeedPayload = { rootId: string; documents: Array<{ id: string; value: Record<string, unknown> }> };

async function seedSnapshot(page: Page, fixture: Fixture) {
    return page.evaluate(async ({ bufferId }) => {
        const [{ automergeRepository }, audio] = await Promise.all([
            import('/src/modules/CrdtDocument/repositories/automergeRepository.ts'),
            import('/src/modules/AudioEngine/useCases/index.ts'),
        ]);
        const buffer = audio.getCachedAudioBuffer({ bufferId });
        if (!buffer) throw new Error('Saved seed lost its real imported PCM');
        const channelHashes = [];
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const digest = await crypto.subtle.digest('SHA-256', buffer.getChannelData(channel).slice().buffer);
            channelHashes.push(
                Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
            );
        }
        return {
            payload: {
                rootId: automergeRepository.getRootId(),
                documents: automergeRepository
                    .getDocIds()
                    .toSorted()
                    .map((id) => ({
                        id,
                        value: JSON.parse(JSON.stringify(automergeRepository.getDoc(id))) as Record<string, unknown>,
                    })),
            },
            pcm: { sampleRate: buffer.sampleRate, length: buffer.length, duration: buffer.duration, channelHashes },
        };
    }, fixture);
}

function expectedSeedAfterInitialLoad(payload: SeedPayload): SeedPayload {
    const copy = structuredClone(payload);
    const root = copy.documents.find((document) => document.id === copy.rootId);
    if (!root) throw new Error('Seed snapshot has no root document');
    const midi = root.value.midi;
    if (midi !== undefined && (midi === null || typeof midi !== 'object' || Array.isArray(midi))) {
        throw new Error('Saved seed MIDI payload must be an object when present');
    }
    const record = midi === undefined ? {} : (midi as Record<string, unknown>);
    if (Object.hasOwn(record, 'noteCoordinateFormat')) {
        expect(record.noteCoordinateFormat).toBe('clip-relative');
    }
    // Predict only the documented one-time addition; every other payload value must agree.
    root.value.midi = { ...record, noteCoordinateFormat: 'clip-relative' };
    return copy;
}

async function reopenCanonicalSeed(page: Page, fixture: Fixture, info: TestInfo): Promise<void> {
    // Persistence acceptance starts from a naturally saved/reopened project.
    // Fresh in-session projects currently write unowned Undo mirrors; ownership
    // is established by the real project loader, never by a test injection.
    let before: Awaited<ReturnType<typeof seedSnapshot>> | undefined;
    await saveReload(page, fixture, 1, async () => {
        before = await seedSnapshot(page, fixture);
    });
    if (!before) throw new Error('Seed was not captured after real Save Project');
    const after = await seedSnapshot(page, fixture);
    expect(after.pcm).toEqual(before.pcm);
    expect(after.payload).toEqual(expectedSeedAfterInitialLoad(before.payload));
    const loadedRoot = after.payload.documents.find((document) => document.id === after.payload.rootId);
    expect(loadedRoot?.value.midi).toHaveProperty('noteCoordinateFormat', 'clip-relative');
    await expect
        .poll(
            async () =>
                page.evaluate(async (id) => {
                    const { captureDurableDocumentWitness } =
                        await import('/src/modules/CrdtDocument/useCases/index.ts');
                    const raw = sessionStorage.getItem('sourdaw-undo-session');
                    const mirror = raw === null ? null : JSON.parse(raw);
                    return {
                        owned: mirror?.projectId === id,
                        currentWitness: mirror?.witness === captureDurableDocumentWitness(),
                    };
                }, fixture.projectId),
            { timeout: 30_000 }
        )
        .toEqual({ owned: true, currentWitness: true });
    expect((await clips(page, fixture.trackId))[0]).toMatchObject({
        id: fixture.clipId,
        startBeat: 2,
        endBeat: 8,
        audioOffsetSeconds: 5.5,
        audioLoopStartSeconds: 5.5,
        loopOriginBeat: 2,
        stretchRatio: 1.5,
    });
    await info.attach('naturally-reopened-seed', {
        body: JSON.stringify({
            before,
            after,
            prerequisite: 'Real Save/reopen before comp/split edits; no injected owner or copied mirror.',
        }),
        contentType: 'application/json',
    });
}

test.describe('Tempo source-time musician acceptance #5039 #5042', () => {
    test.setTimeout(240_000);

    test('real imported phrase survives comp split, live/export, saved replay and tempo relocation', async ({
        page,
    }, info) => {
        const fixture = await importFixture(page);
        await reopenCanonicalSeed(page, fixture, info);
        await exportPcm(page, info, 'before-comp-split');
        await trackRow(page, fixture).getByRole('button', { name: 'Toggle variation lanes', exact: true }).click();
        await page.getByRole('button', { name: 'Add take', exact: true }).click();
        const takeId = await page.evaluate(async (id) => {
            const { takeLaneStore } = await import('/src/modules/Arrangement/stores/index.ts');
            const take = takeLaneStore.value?.lanes.find((lane) => lane.trackId === id)?.takes[0];
            if (!take) throw new Error('Real Add take UI did not publish a take');
            return take.id;
        }, fixture.trackId);
        await action(page, {
            type: 'setCompRegion',
            payload: { trackId: fixture.trackId, startBeat: 2, endBeat: 8, takeId },
        });
        await realPlayback(page, fixture, info, 'before-split');
        const rightId = await splitUi(page, fixture);
        await expect
            .poll(async () =>
                page.evaluate(async (id) => {
                    const { takeLaneStore } = await import('/src/modules/Arrangement/stores/index.ts');
                    return takeLaneStore.value?.lanes
                        .find((lane) => lane.trackId === id)
                        ?.activeCompRegions.map(({ startBeat, endBeat }) => [startBeat, endBeat]);
                }, fixture.trackId)
            )
            .toEqual([
                [2, 4],
                [4, 8],
            ]);
        await assertWaveformPixels(page, fixture, info, 'canonical-right-fragment', [
            { startBeat: 5.5, baselineBeat: 5 },
            { startBeat: 6.5, baselineBeat: 6.1 },
        ]);
        await realPlayback(page, fixture, info, 'after-comp-split');
        await exportPcm(page, info, 'after-comp-split');
        await saveReload(page, fixture);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(async () => (await clips(page, fixture.trackId)).length).toBe(1);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect.poll(async () => (await clips(page, fixture.trackId)).length).toBe(2);
        await exportPcm(page, info, 'saved-replayed-comp-split');
        // Finish the selected-comp replay proof before isolating movement from comp bounds.
        // These are real UI region removals and an ordinary mute, never a store fixture.
        const lanes = trackRow(page, fixture).getByRole('button', { name: 'Toggle variation lanes', exact: true });
        if ((await lanes.getAttribute('aria-pressed')) !== 'true') await lanes.click();
        for (let remaining = 2; remaining > 0; remaining--) {
            const regions = page.getByRole('button', { name: /^Remove comp region / });
            await expect(regions).toHaveCount(remaining);
            await regions.first().click();
        }
        await action(page, { type: 'muteClip', payload: { clipId: fixture.clipId, muted: true } });
        await action(page, { type: 'moveClip', payload: { clipId: rightId, trackId: fixture.trackId, startBeat: 0 } });
        // Exact typed trim: inspector's range is shared with the overlapping left fragment.
        await action(page, { type: 'trimClipStart', payload: { clipId: rightId, newStartBeat: 1 } });
        expect((await clips(page, fixture.trackId)).find((clip) => clip.id === rightId)).toMatchObject({
            startBeat: 1,
            audioOffsetSeconds: 7.75,
            audioLoopStartSeconds: 5.5,
            loopOriginBeat: -2,
        });
        await exportPcm(page, info, 'moved-trimmed-source', [
            { name: 'moved trimmed head7.75', songSecond: 0.5, sourceSecond: 7.75, rate: 1.5 },
            { name: 'moved reset5.5', songSecond: 1, sourceSecond: 5.5, rate: 1.5 },
            { name: 'moved source6.25', songSecond: 1.5, sourceSecond: 6.25, rate: 1.5 },
        ]);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        expect((await clips(page, fixture.trackId)).find((clip) => clip.id === rightId)).toMatchObject({
            startBeat: 4,
            audioOffsetSeconds: 7,
            audioLoopStartSeconds: 5.5,
        });
    });

    test('legacy clip-start clock and visible waveform, Strip Silence and MIDI select the actual phrase', async ({
        page,
    }, info) => {
        const fixture = await importFixture(page);
        // Real registered addClip with the actual imported asset: prove beat-only legacy
        // fallback independently of canonical seconds created by a trim.
        await action(page, { type: 'muteClip', payload: { clipId: fixture.clipId, muted: true } });
        await action(page, {
            type: 'moveClip',
            payload: { clipId: fixture.clipId, trackId: fixture.trackId, startBeat: 20 },
        });
        await action(page, {
            type: 'addClip',
            payload: {
                trackId: fixture.trackId,
                startBeat: 4,
                endBeat: 8,
                name: 'Legacy clip-start clock',
                type: 'audio',
                audioBufferId: fixture.bufferId,
                ...(fixture.assetHash ? { assetHash: fixture.assetHash } : {}),
                audioOffsetBeats: 6.25,
            },
        });
        const legacy = (await clips(page, fixture.trackId)).find((clip) => clip.name === 'Legacy clip-start clock');
        if (!legacy) throw new Error('Registered addClip did not create the legacy fixture');
        expect(Object.hasOwn(legacy, 'audioOffsetSeconds')).toBe(false);
        await exportPcm(page, info, 'legacy-clip-start-clock', [
            { name: 'legacy head source6.25 at beat4', songSecond: 2, sourceSecond: 6.25, rate: 1 },
            { name: 'legacy source9.25 at beat7', songSecond: 5, sourceSecond: 9.25, rate: 1 },
        ]);
        expect(
            Object.hasOwn(
                (await clips(page, fixture.trackId)).find((clip) => clip.id === legacy.id)!,
                'audioOffsetSeconds'
            )
        ).toBe(false);
        await assertWaveformPixels(page, fixture, info, 'legacy-clip-start-clock', [
            { startBeat: 4, baselineBeat: 4.6 },
            { startBeat: 7, baselineBeat: 6.4 },
        ]);
        await clipMenu(page, fixture, 5, 'Strip Silence');
        await expect.poll(async () => (await clips(page, fixture.trackId)).length).toBe(3);
        const fragments = (await clips(page, fixture.trackId))
            .filter((clip) => clip.id !== fixture.clipId)
            .sort((left, right) => left.startBeat - right.startBeat);
        expect(fragments).toHaveLength(2);
        expect(fragments[0].startBeat).toBeCloseTo(4, 1);
        expect(fragments[1].startBeat).toBeCloseTo(7, 1);
        expect(fragments[0].audioOffsetSeconds).toBeCloseTo(6.25, 1);
        expect(fragments[1].audioOffsetSeconds).toBeCloseTo(9.25, 1);
        expect(fragments.every((clip) => (clip.audioOffsetSeconds ?? 0) < 10)).toBe(true);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect
            .poll(async () => (await clips(page, fixture.trackId)).some((clip) => clip.id === legacy.id))
            .toBe(true);
        // Onset detection needs quiet input before a rising edge. Keep all head6.25
        // export/waveform/silence proofs above, then use another beat-only reader
        // window with 0.25sec of leading quiet for both independently known bursts.
        await action(page, { type: 'removeClip', payload: { clipId: legacy.id } });
        await action(page, {
            type: 'addClip',
            payload: {
                trackId: fixture.trackId,
                startBeat: 4,
                endBeat: 8,
                name: 'Legacy MIDI clip-start clock',
                type: 'audio',
                audioBufferId: fixture.bufferId,
                ...(fixture.assetHash ? { assetHash: fixture.assetHash } : {}),
                audioOffsetBeats: 6,
            },
        });
        const midiSource = (await clips(page, fixture.trackId)).find(
            (clip) => clip.name === 'Legacy MIDI clip-start clock'
        );
        if (!midiSource) throw new Error('Registered addClip did not create the legacy MIDI source');
        expect(Object.hasOwn(midiSource, 'audioOffsetSeconds')).toBe(false);
        await page.getByLabel('Timeline editor surface').click({ position: await clipPoint(page, fixture, 5) });
        await page.getByRole('button', { name: 'MIDI (Basic)', exact: true }).click();
        await expect
            .poll(
                async () =>
                    page.evaluate(async () => {
                        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
                        return (
                            trackStore.value?.tracks
                                .flatMap((track) => track.clips)
                                .filter((clip) => clip.name.includes('→ MIDI')).length ?? 0
                        );
                    }),
                { timeout: 20_000 }
            )
            .toBe(1);
        const converted = await page.evaluate(async () => {
            const [arrangement, midi] = await Promise.all([
                import('/src/modules/Arrangement/stores/index.ts'),
                import('/src/modules/MIDI/useCases/index.ts'),
            ]);
            const clip = arrangement.trackStore.value?.tracks
                .flatMap((track) => track.clips)
                .find((candidate) => candidate.name.includes('→ MIDI'));
            if (!clip) throw new Error('Real MIDI Basic action produced no MIDI clip');
            const rawNotes = midi.getNotesForClip(clip.id);
            return {
                clipId: clip.id,
                trackId: clip.trackId,
                rawNotes,
                notes: rawNotes.map((note) => ({
                    absoluteBeat: clip.startBeat + note.startBeat,
                    relativeBeat: note.startBeat,
                })),
            };
        });
        const notes = converted.notes;
        const detectorSampleRate = await page.evaluate(async (bufferId) => {
            const { getCachedAudioBuffer } = await import('/src/modules/AudioEngine/useCases/index.ts');
            const buffer = getCachedAudioBuffer({ bufferId });
            if (!buffer) throw new Error('Actual decoded source is unavailable for detector-frame units');
            return buffer.sampleRate;
        }, fixture.bufferId);
        // The frame count is fixed; decoded source rate, rather than WAV input rate, sets its duration.
        const detectorBeatTolerance = (DETECTOR_BEAT_TOLERANCE * RATE) / detectorSampleRate;
        expect(notes).toHaveLength(2);
        expect(Math.abs(notes[0].relativeBeat - 0.25)).toBeLessThan(detectorBeatTolerance);
        expect(Math.abs(notes[1].relativeBeat - 3.25)).toBeLessThan(detectorBeatTolerance);
        expect(notes.map((note) => note.absoluteBeat).every((beat) => beat >= 4 && beat < 8)).toBe(true);
        await page.getByTestId('transport-undo').click();
        await expect
            .poll(async () =>
                page.evaluate(async (id) => {
                    const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
                    return trackStore.value?.tracks.some((track) => track.id === id);
                }, converted.trackId)
            )
            .toBe(false);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect
            .poll(async () =>
                page.evaluate(async ({ clipId, trackId }) => {
                    const [arrangement, midi] = await Promise.all([
                        import('/src/modules/Arrangement/stores/index.ts'),
                        import('/src/modules/MIDI/useCases/index.ts'),
                    ]);
                    const clip = arrangement.trackStore.value?.tracks
                        .find((track) => track.id === trackId)
                        ?.clips.find((clip) => clip.id === clipId);
                    return clip ? midi.getNotesForClip(clipId) : null;
                }, converted)
            )
            .toEqual(converted.rawNotes);
        await info.attach('actual-silence-fragments-and-midi', {
            body: JSON.stringify({ fragments, notes, detectorSampleRate, detectorBeatTolerance }),
            contentType: 'application/json',
        });
    });
});
