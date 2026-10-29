import { cpus, platform, release } from 'node:os';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const RATE = 48_000;
const SECONDS = 120;
const ATTACKS = Array.from({ length: 120 }, (_, index) => index + 0.25);

function percussiveStereoWav(): Buffer {
    const frames = RATE * SECONDS;
    const bytes = frames * 4;
    const wav = Buffer.alloc(44 + bytes);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + bytes, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(RATE, 24);
    wav.writeUInt32LE(RATE * 4, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(bytes, 40);
    for (const attack of ATTACKS) {
        const start = Math.round(attack * RATE);
        for (let frame = 0; frame < 2400; frame++) {
            const sample = Math.round(
                14_000 * Math.sin((2 * Math.PI * 1000 * frame) / RATE) * Math.exp((-6 * frame) / 2400)
            );
            wav.writeInt16LE(sample, 44 + (start + frame) * 4);
            wav.writeInt16LE(Math.round(sample * 0.75), 46 + (start + frame) * 4);
        }
    }
    return wav;
}

async function sourceState(page: Page, last = false) {
    return page.evaluate(async (last) => {
        const { trackStore, getWarpState } = await import('/src/modules/Arrangement/stores/index.ts');
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/index.ts');
        const { getCrdtDoc } = await import('/src/modules/CrdtDocument/useCases/index.ts');
        const clips =
            trackStore.value?.tracks
                .flatMap((track) => track.clips)
                .filter((candidate) => candidate.type === 'audio') ?? [];
        const clip = last ? clips.at(-1) : clips[0];
        const source = clip?.audioBufferId ? audioBufferCache.get(clip.audioBufferId) : undefined;
        const pcm = [];
        if (source) {
            for (let channel = 0; channel < source.numberOfChannels; channel++) {
                const samples = new Float32Array(source.getChannelData(channel));
                pcm.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', samples.buffer))).join(','));
            }
        }
        const projected = clip ? getWarpState(clip.id).markers : [];
        const raw = getCrdtDoc<{ warpStates?: { states: Record<string, { markers: unknown[] }> } }>('root');
        return {
            clipId: clip?.id,
            ready: Boolean(source),
            sampleRate: source?.sampleRate,
            frames: source?.length,
            channels: source?.numberOfChannels,
            pcm,
            projected,
            raw: clip ? (raw?.warpStates?.states[clip.id]?.markers ?? []) : [],
        };
    }, last);
}

test('120-second stereo Detect includes cold Worker, copy and atomic commit within responsive UI budget', async ({
    page,
}, info) => {
    test.setTimeout(120_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    const modifier = await page.evaluate(() => (navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'));
    await page.keyboard.press(`${modifier}+K`);
    const palette = page.getByRole('dialog', { name: /Command Palette/i });
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder(/Type a command/i).fill('Add Audio Track');
    await palette.getByRole('option', { name: /Add Audio Track/i }).click();
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (
        await chooser
    ).setFiles({ name: '120s-48k-stereo-attacks.wav', mimeType: 'audio/wav', buffer: percussiveStereoWav() });
    await expect.poll(async () => (await sourceState(page)).ready).toBe(true);
    const before = await sourceState(page);
    expect(before.sampleRate).toBe(RATE);
    expect(before.frames).toBe(RATE * SECONDS);
    expect(before.channels).toBe(2);
    expect(before.projected).toEqual([]);
    await page.getByLabel('Timeline editor surface').click({ position: { x: 30, y: 20 } });
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) !== 'true') await dock.click();
    await page.locator('#bottom-dock-tab-elastic').click();
    const panel = page.getByTestId('elastic-editor-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('elastic-detect-button')).toBeEnabled();
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.evaluate(async () => {
        type Metrics = {
            start: number;
            end: number;
            frames: number[];
            observedFrames: number[];
            tasks: { start: number; duration: number }[];
            measures: { name: string; duration: number }[];
        };
        const metrics: Metrics = { start: 0, end: 0, frames: [], observedFrames: [], tasks: [], measures: [] };
        const target = window as Window & { elasticMeasurement?: Promise<Metrics> };
        const button = document.querySelector('[data-testid="elastic-detect-button"]');
        const status = document.querySelector('[data-testid="elastic-editor-panel"] [role="status"]');
        if (!button || !status) throw new Error('Required Detect entry and completion status must be mounted');
        let stop = false;
        const frame = (time: number): void => {
            metrics.frames.push(time);
            metrics.observedFrames.push(performance.now());
            if (!stop) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        const tasks = new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
                metrics.tasks.push({ start: entry.startTime, duration: entry.duration });
        });
        tasks.observe({ type: 'longtask', buffered: false });
        const measures = new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
                if (entry.name.startsWith('elastic-transient-'))
                    metrics.measures.push({ name: entry.name, duration: entry.duration });
        });
        measures.observe({ type: 'measure', buffered: false });
        target.elasticMeasurement = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                stop = true;
                observer.disconnect();
                tasks.disconnect();
                measures.disconnect();
                reject(new Error('Real Detect did not complete'));
            }, 10_000);
            const observer = new MutationObserver(() => {
                if (status.textContent !== 'Detection complete') return;
                metrics.end = performance.now();
                observer.disconnect();
                requestAnimationFrame((time) => {
                    metrics.frames.push(time);
                    metrics.observedFrames.push(performance.now());
                    requestAnimationFrame((tailTime) => {
                        metrics.frames.push(tailTime);
                        metrics.observedFrames.push(performance.now());
                        stop = true;
                        tasks.disconnect();
                        measures.disconnect();
                        clearTimeout(timeout);
                        resolve(metrics);
                    });
                });
            });
            observer.observe(status, { childList: true, subtree: true, characterData: true });
            button.addEventListener(
                'click',
                () => {
                    metrics.start = performance.now();
                },
                { once: true, capture: true }
            );
        });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await panel.getByTestId('elastic-detect-button').click();
    const measured = await page.evaluate(async () => {
        const target = window as Window & {
            elasticMeasurement?: Promise<{
                start: number;
                end: number;
                frames: number[];
                observedFrames: number[];
                tasks: { start: number; duration: number }[];
                measures: { name: string; duration: number }[];
            }>;
        };
        if (!target.elasticMeasurement) throw new Error('Measurement was not installed');
        return target.elasticMeasurement;
    });
    const after = await sourceState(page);
    const gaps = measured.frames.slice(1).flatMap((time, index) => {
        const previous = measured.frames[index]!;
        return time >= measured.start ? [time - previous] : [];
    });
    const observedGaps = measured.observedFrames
        .slice(1)
        .flatMap((time, index) => (time >= measured.start ? [time - measured.observedFrames[index]!] : []));
    const commit = measured.measures.filter((entry) => entry.name === 'elastic-transient-commit');
    const copy = measured.measures.filter((entry) => entry.name === 'elastic-transient-copy-task');
    const commitTasks = measured.measures.filter(
        (entry) =>
            entry.name === 'elastic-transient-preparation-task' ||
            entry.name === 'elastic-transient-storage-commit-task'
    );
    const longTasks = measured.tasks.filter(
        (entry) => entry.start < measured.end && entry.start + entry.duration > measured.start
    );
    const result = {
        ...measured,
        elapsedMs: measured.end - measured.start,
        gaps,
        observedGaps,
        maxObservedGapMs: Math.max(...observedGaps),
        maxGapMs: Math.max(...gaps),
        commit,
        copy,
        longTasks,
        workers,
        machine: {
            cpu: cpus()[0]?.model,
            platform: platform(),
            release: release(),
            browserVersion: page.context().browser()?.version(),
        },
        commitTasks,
        browser: await page.evaluate(() => navigator.userAgent),
        criterion:
            '60 Hz: each synchronous copy/preparation/storage-commit task <= 16.667 ms; capture-to-afterCommit wall span reported separately; observed rAF gaps <= 25 ms; no >=50 ms main-thread task during the same click-to-UI-completion interval',
    };
    await info.attach('elastic-120-second-performance.json', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
    });
    expect(workers.filter((url) => url.includes('transientOnsetWorker'))).toHaveLength(1);
    expect(after.pcm).toEqual(before.pcm);
    expect(after.raw).toEqual(after.projected);
    expect(after.projected).toHaveLength(ATTACKS.length);
    for (const [index, marker] of after.projected.entries())
        expect(Math.abs(marker.originalBeat / 2 - ATTACKS[index]!)).toBeLessThan(0.04);
    expect(commit).toHaveLength(1);
    expect(copy.length).toBeGreaterThan(1);
    expect(gaps.length).toBeGreaterThan(1);
    expect(result.elapsedMs).toBeLessThan(1000);
    expect(Math.max(...copy.map((entry) => entry.duration))).toBeLessThanOrEqual(1000 / 60);
    expect(commitTasks).toHaveLength(2);
    expect(Math.max(...commitTasks.map((entry) => entry.duration))).toBeLessThanOrEqual(1000 / 60);
    expect(result.maxGapMs).toBeLessThanOrEqual(25);
    expect(result.maxObservedGapMs).toBeLessThanOrEqual(25);
    expect(longTasks).toEqual([]);
    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(async () => (await sourceState(page)).projected.length).toBe(0);
    await page.keyboard.press(`${modifier}+Shift+z`);
    await expect.poll(async () => (await sourceState(page)).projected.length).toBe(ATTACKS.length);
    expect((await sourceState(page)).pcm).toEqual(before.pcm);

    const canvas = panel.getByTestId('elastic-waveform-canvas');
    const firstMarker = after.projected[0];
    if (!firstMarker) throw new Error('Expected first detected onset');
    await panel.getByTestId('elastic-tool-lock-marker').click();
    await canvas.click({ position: { x: firstMarker.warpedBeat * 40, y: 30 } });
    await expect(panel.getByTestId('elastic-detail-strip')).toContainText('1 locked');
    await panel.getByTestId('elastic-tool-add-marker').click();
    await canvas.click({ position: { x: 0.9 * 40, y: 30 } });
    await expect(panel.getByTestId('elastic-detail-strip')).toContainText('1 user');
    await panel.getByTestId('elastic-tool-select').click();
    const populated = await sourceState(page);
    await expect.poll(async () => (await sourceState(page)).raw).toEqual(populated.projected);
    expect(populated.projected).toHaveLength(ATTACKS.length + 1);
    const retained = populated.projected.filter((marker) => marker.locked || marker.origin === 'user');
    expect(retained).toHaveLength(2);

    await armPopulatedMeasurement(page, 'click');
    await panel.getByTestId('elastic-detect-button').click();
    await assertPopulatedMeasurement(page, info, 're-detect-populated', populated, retained);
    expect(workers.filter((url) => url.includes('transientOnsetWorker'))).toHaveLength(2);
    const redetected = await sourceState(page);
    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(async () => (await sourceState(page)).projected).toEqual(populated.projected);
    await page.keyboard.press(`${modifier}+Shift+z`);
    await expect.poll(async () => (await sourceState(page)).projected).toEqual(redetected.projected);

    await armPopulatedMeasurement(page, 'sensitivity');
    await panel.getByRole('slider', { name: 'Transient detection sensitivity' }).press('End');
    await assertPopulatedMeasurement(page, info, 'sensitivity-populated', populated, retained);
    expect(workers.filter((url) => url.includes('transientOnsetWorker'))).toHaveLength(3);
    const sensitive = await sourceState(page);
    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(async () => (await sourceState(page)).projected).toEqual(redetected.projected);
    await page.keyboard.press(`${modifier}+Shift+z`);
    await expect.poll(async () => (await sourceState(page)).projected).toEqual(sensitive.projected);
    expect((await sourceState(page)).pcm).toEqual(before.pcm);
});

/** Same five-amplitude pulse fixture as the accepted Elastic sensitivity integration. */
function preferencePulseWav(): Buffer {
    const rate = 44_100;
    const frames = rate * 3;
    const wav = Buffer.alloc(44 + frames * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(frames * 2, 40);
    for (const [attack, amplitude] of [14000, 2000, 14000, 3000, 14000].entries()) {
        const start = Math.floor(rate * (0.25 + attack * 0.4));
        for (let frame = 0; frame < 2205; frame++) {
            const sample = Math.round(
                amplitude * Math.sin((2 * Math.PI * 1000 * frame) / rate) * Math.exp((-6 * frame) / 2205)
            );
            wav.writeInt16LE(sample, 44 + (start + frame) * 2);
        }
    }
    return wav;
}

async function importPreferenceClip(page: Page, name: string): Promise<string> {
    const modifier = await page.evaluate(() => (navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'));
    await page.keyboard.press(`${modifier}+K`);
    const palette = page.getByRole('dialog', { name: /Command Palette/i });
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder(/Type a command/i).fill('Add Audio Track');
    await palette.getByRole('option', { name: /Add Audio Track/i }).click();
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .last();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (await chooser).setFiles({ name, mimeType: 'audio/wav', buffer: preferencePulseWav() });
    await expect
        .poll(async () =>
            page.evaluate(async (name) => {
                const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
                return trackStore.value?.tracks
                    .flatMap((track) => track.clips)
                    .some((clip) => clip.name.includes(name.replace('.wav', '')));
            }, name)
        )
        .toBe(true);
    const state = await sourceState(page, true);
    if (!state.clipId) throw new Error('Imported new clip is missing');
    await page.evaluate(async (clipId) => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        const { selectClip } = await import('/src/modules/Arrangement/useCases/index.ts');
        selectClip(clipId);
        await executeAppAction({ type: 'openElasticEditor', payload: { clipId } });
    }, state.clipId);
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) !== 'true') await dock.click();
    await page.locator('#bottom-dock-tab-elastic').click();
    await expect(page.getByTestId('elastic-editor-panel')).toBeVisible();
    return state.clipId;
}

test('saved 82 sensitivity seeds first Worker Detect on a new clip after completed reload, and Reset uses 50', async ({
    page,
}, info) => {
    test.setTimeout(120_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    const firstClip = await importPreferenceClip(page, 'preference-original.wav');
    const slider = page.getByRole('slider', { name: 'Transient detection sensitivity' });
    await slider.press('End');
    for (let count = 0; count < 18; count++) await slider.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '82');
    await expect
        .poll(async () =>
            page.evaluate(async () => {
                const { elasticAudioStore } = await import('/src/modules/ElasticAudio/stores/index.ts');
                return elasticAudioStore.value?.detected;
            })
        )
        .toBe(true);
    // setupWorkspace's page-local init script clears storage at navigation. A new Page
    // receives only the viewport context script, so its literal reload preserves real settings.
    const reloaded = await page.context().newPage();
    const url = page.url();
    await page.close();
    await reloaded.goto(url);
    await wait_for_workspace_ready(reloaded);
    await reloaded.reload();
    await wait_for_workspace_ready(reloaded);
    const newClip = await importPreferenceClip(reloaded, 'preference-new-after-reload.wav');
    expect(newClip).not.toBe(firstClip);
    const initial = await sourceState(reloaded, true);
    expect(initial.projected).toEqual([]);
    const expected = await reloaded.evaluate(async (clipId) => {
        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/index.ts');
        const { detectTransients } = await import('/src/modules/ElasticAudio/useCases/index.ts');
        const { preferencesStore } = await import('/src/modules/Preferences/stores/index.ts');
        const clip = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === clipId);
        const source = clip?.audioBufferId ? audioBufferCache.get(clip.audioBufferId) : undefined;
        if (!source || source.numberOfChannels !== 1) throw new Error('Expected imported mono PCM');
        return {
            saved: preferencesStore.value?.elasticTransientSensitivity,
            high: detectTransients(source.getChannelData(0), source.sampleRate, 0.82),
            defaults: detectTransients(source.getChannelData(0), source.sampleRate, 0.5),
            sampleRate: source.sampleRate,
        };
    }, newClip);
    expect(expected.saved).toBe(0.82);
    expect(expected.high).not.toEqual(expected.defaults);
    const panel = reloaded.getByTestId('elastic-editor-panel');
    await panel.getByTestId('elastic-detect-button').click();
    await expect(panel.getByRole('status')).toHaveText('Detection complete');
    const high = await sourceState(reloaded, true);
    expect(high.projected.map((marker) => marker.originalBeat)).toEqual(
        expected.high.map((hit) => (hit.sampleOffset / expected.sampleRate) * 2)
    );
    expect(high.raw).toEqual(high.projected);
    expect(high.pcm).toEqual(initial.pcm);
    const modifier = await reloaded.evaluate(() =>
        navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'
    );
    await reloaded.keyboard.press(`${modifier}+,`);
    const preferences = reloaded.getByRole('dialog', { name: 'Preferences' });
    await expect(preferences).toBeVisible();
    await preferences.getByRole('button', { name: 'Reset Defaults' }).click();
    await reloaded.keyboard.press('Escape');
    await expect(panel.getByRole('slider', { name: 'Transient detection sensitivity' })).toHaveAttribute(
        'aria-valuenow',
        '50'
    );
    await panel.getByTestId('elastic-detect-button').click();
    await expect
        .poll(async () => (await sourceState(reloaded, true)).projected.map((marker) => marker.originalBeat))
        .toEqual(expected.defaults.map((hit) => (hit.sampleOffset / expected.sampleRate) * 2));
    const reset = await sourceState(reloaded, true);
    expect(reset.raw).toEqual(reset.projected);
    expect(reset.pcm).toEqual(initial.pcm);
    await info.attach('elastic-first-detection-preference.json', {
        body: JSON.stringify({ expected, high: high.projected, reset: reset.projected }),
        contentType: 'application/json',
    });
    await reloaded.close();
});

// Repeat routes retain the cold case's fixture, thresholds, observation clocks and full completion boundary.
async function armPopulatedMeasurement(page: Page, route: 'click' | 'sensitivity'): Promise<void> {
    await page.evaluate(async (route) => {
        type Metrics = {
            start: number;
            end: number;
            frames: number[];
            observedFrames: number[];
            tasks: { start: number; duration: number }[];
            measures: { name: string; duration: number }[];
        };
        const metrics: Metrics = { start: 0, end: 0, frames: [], observedFrames: [], tasks: [], measures: [] };
        const target = window as Window & { populatedElasticMeasurement?: Promise<Metrics> };
        const control = document.querySelector(
            route === 'click'
                ? '[data-testid="elastic-detect-button"]'
                : '[data-testid="elastic-editor-panel"] [role="slider"][aria-label="Transient detection sensitivity"]'
        );
        const status = document.querySelector('[data-testid="elastic-editor-panel"] [role="status"]');
        if (!control || !status) throw new Error('Required production control and completion state are missing');
        let stop = false;
        let sawPending = false;
        const frame = (time: number): void => {
            metrics.frames.push(time);
            metrics.observedFrames.push(performance.now());
            if (!stop) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        const tasks = new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
                metrics.tasks.push({ start: entry.startTime, duration: entry.duration });
        });
        tasks.observe({ type: 'longtask', buffered: false });
        const measures = new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
                if (entry.name.startsWith('elastic-transient-'))
                    metrics.measures.push({ name: entry.name, duration: entry.duration });
        });
        measures.observe({ type: 'measure', buffered: false });
        target.populatedElasticMeasurement = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                stop = true;
                observer.disconnect();
                tasks.disconnect();
                measures.disconnect();
                reject(new Error('Populated real Detect did not complete'));
            }, 10_000);
            const observer = new MutationObserver(() => {
                if (status.textContent === 'Detecting…') sawPending = true;
                if (
                    !metrics.start ||
                    !sawPending ||
                    status.textContent !== (route === 'click' ? 'Detection complete' : '')
                )
                    return;
                metrics.end = performance.now();
                observer.disconnect();
                requestAnimationFrame((time) => {
                    metrics.frames.push(time);
                    metrics.observedFrames.push(performance.now());
                    requestAnimationFrame((tail) => {
                        metrics.frames.push(tail);
                        metrics.observedFrames.push(performance.now());
                        stop = true;
                        tasks.disconnect();
                        measures.disconnect();
                        clearTimeout(timeout);
                        resolve(metrics);
                    });
                });
            });
            observer.observe(status, { childList: true, subtree: true, characterData: true });
            control.addEventListener(
                route === 'click' ? 'click' : 'keydown',
                () => {
                    metrics.start = performance.now();
                },
                { once: true, capture: true }
            );
        });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }, route);
}

async function assertPopulatedMeasurement(
    page: Page,
    info: TestInfo,
    phase: string,
    before: Awaited<ReturnType<typeof sourceState>>,
    retained: Awaited<ReturnType<typeof sourceState>>['projected']
): Promise<void> {
    const measured = await page.evaluate(async () => {
        const target = window as Window & {
            populatedElasticMeasurement?: Promise<{
                start: number;
                end: number;
                frames: number[];
                observedFrames: number[];
                tasks: { start: number; duration: number }[];
                measures: { name: string; duration: number }[];
            }>;
        };
        if (!target.populatedElasticMeasurement) throw new Error('Measurement is missing');
        return target.populatedElasticMeasurement;
    });
    const gaps = measured.frames
        .slice(1)
        .flatMap((time, index) => (time >= measured.start ? [time - measured.frames[index]!] : []));
    const observedGaps = measured.observedFrames
        .slice(1)
        .flatMap((time, index) => (time >= measured.start ? [time - measured.observedFrames[index]!] : []));
    const copy = measured.measures.filter((entry) => entry.name === 'elastic-transient-copy-task');
    const commitTasks = measured.measures.filter(
        (entry) =>
            entry.name === 'elastic-transient-preparation-task' ||
            entry.name === 'elastic-transient-storage-commit-task'
    );
    const longTasks = measured.tasks.filter(
        (entry) => entry.start < measured.end && entry.start + entry.duration > measured.start
    );
    const result = {
        ...measured,
        phase,
        elapsedMs: measured.end - measured.start,
        maxGapMs: Math.max(...gaps),
        maxObservedGapMs: Math.max(...observedGaps),
        copy,
        commitTasks,
        longTasks,
    };
    await info.attach(`elastic-120-second-${phase}.json`, {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
    });
    const after = await sourceState(page);
    expect(after.raw).toEqual(after.projected);
    expect(after.pcm).toEqual(before.pcm);
    expect(after.projected).toHaveLength(ATTACKS.length + 1);
    expect(after.projected.filter((marker) => marker.locked || marker.origin === 'user')).toEqual(retained);
    const onsets = after.projected.filter((marker) => marker.origin === 'transient-auto');
    expect(onsets).toHaveLength(ATTACKS.length);
    for (const [index, marker] of onsets.entries())
        expect(Math.abs(marker.originalBeat / 2 - ATTACKS[index]!)).toBeLessThan(0.04);
    expect(result.elapsedMs).toBeLessThan(1000);
    expect(copy.length).toBeGreaterThan(1);
    expect(commitTasks).toHaveLength(2);
    expect(Math.max(...copy.map((entry) => entry.duration))).toBeLessThanOrEqual(1000 / 60);
    expect(Math.max(...commitTasks.map((entry) => entry.duration))).toBeLessThanOrEqual(1000 / 60);
    expect(result.maxGapMs).toBeLessThanOrEqual(25);
    expect(result.maxObservedGapMs).toBeLessThanOrEqual(25);
    expect(longTasks).toEqual([]);
}
