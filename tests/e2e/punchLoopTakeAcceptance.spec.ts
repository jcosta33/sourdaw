import { readFile, writeFile } from 'node:fs/promises';

import { chromium, expect, test, type Page, type TestInfo } from '@playwright/test';

import { launch_new_project, setupWorkspace, wait_for_launch_first_paint, wait_for_workspace_ready } from './e2eUtils';
import { attach_first_paint_console, CAPABILITIES_MARKER, wait_for_console_marker } from './firstPaintDiagnostics';

const PROJECT_NAME = 'Punch loop microphone acceptance';
const LOOP_START = 8;
const LOOP_END = 12;
const PUNCH_IN = 10;
const PUNCH_OUT = 14;
const TEMPO = 120;
const MIC_SAMPLE_RATE = 48_000;
const MIC_SECONDS = 24;
const MARKER_SECONDS = 0.4;
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

type CapturedTake = {
    id: string;
    name: string;
    clipId: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
    passDepthSeconds?: number;
    passSourceEndSeconds?: number;
};

type RecordingSnapshot = {
    clipId: string;
    bufferId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    takes: CapturedTake[];
    regions: { startBeat: number; endBeat: number; takeId: string }[];
    durationSeconds: number;
};

type NativeStart = { offsetSeconds: number; durationSeconds: number | null; recordedBuffer: boolean };

function markerAmplitude(index: number): number {
    let value = Math.imul(index + 1, 0x9e37_79b1) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x85eb_ca6b) >>> 0;
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2_ae35) >>> 0;
    value ^= value >>> 16;
    return 0.07 + ((value >>> 0) / 0xffff_ffff) * 0.34;
}

function fakeMicrophoneWav(): Buffer {
    const frameCount = MIC_SECONDS * MIC_SAMPLE_RATE;
    const wav = Buffer.alloc(44 + frameCount * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(MIC_SAMPLE_RATE, 24);
    wav.writeUInt32LE(MIC_SAMPLE_RATE * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(frameCount * 2, 40);
    for (let frame = 0; frame < frameCount; frame++) {
        const seconds = frame / MIC_SAMPLE_RATE;
        const marker = Math.floor(seconds / MARKER_SECONDS);
        const phase = seconds % MARKER_SECONDS;
        const edge = Math.min(1, phase / 0.005, (MARKER_SECONDS - phase) / 0.005);
        const sample = markerAmplitude(marker) * Math.max(0, edge) * Math.sin(2 * Math.PI * 440 * seconds);
        wav.writeInt16LE(Math.round(sample * 32_000), 44 + frame * 2);
    }
    return wav;
}

function correlation(left: number[], right: number[]): number {
    const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
    const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
    let product = 0;
    let leftSquare = 0;
    let rightSquare = 0;
    for (let index = 0; index < left.length; index++) {
        const a = left[index] - leftMean;
        const b = right[index] - rightMean;
        product += a * b;
        leftSquare += a * a;
        rightSquare += b * b;
    }
    return product / Math.sqrt(leftSquare * rightSquare);
}

function bestMicTimecodeMatch(recordedRms: number[]): number {
    const observed = recordedRms.slice(2, -2);
    let best = -1;
    for (let start = 0; start <= MIC_SECONDS - recordedRms.length * 0.1; start += 0.1) {
        const expected = observed.map((_, index) =>
            markerAmplitude(Math.floor((start + (index + 2) * 0.1) / MARKER_SECONDS))
        );
        best = Math.max(best, correlation(observed, expected));
    }
    return best;
}

async function installNativePlaybackObserver(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const nativeStart = AudioBufferSourceNode.prototype.start;
        Reflect.set(window, '__punchStarts', []);
        AudioBufferSourceNode.prototype.start = function (...args): void {
            const starts = Reflect.get(window, '__punchStarts') as NativeStart[];
            starts.push({
                offsetSeconds: args[1] ?? 0,
                durationSeconds: args[2] ?? null,
                recordedBuffer: this.buffer === Reflect.get(window, '__punchRecordedBuffer'),
            });
            Reflect.apply(nativeStart, this, args);
        };
    });
}

async function installDownloadFallback(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Reflect.deleteProperty(window, 'showSaveFilePicker');
    });
}

async function settledReopenMode(
    page: Page,
    savedProjectId: string
): Promise<'saved-active' | 'launch-ready' | 'wrong-active' | 'pending'> {
    const project = await page.evaluate(async () => {
        const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
        const state = projectStore.value;
        return state ? { id: state.projectId, initialized: state.initialized, loading: state.loading } : null;
    });
    if (!project || project.loading) {
        return 'pending';
    }
    if (project.initialized) {
        return project.id === savedProjectId ? 'saved-active' : 'wrong-active';
    }
    const launch = page.getByLabel('Sourdaw — start a project');
    const recent = page.getByRole('button', { name: `Open recent project ${PROJECT_NAME}` });
    const launchActive = await launch.evaluateAll((elements) => {
        const element = elements[0];
        if (!element) {
            return false;
        }
        const style = window.getComputedStyle(element);
        return style.opacity !== '0' && style.pointerEvents !== 'none';
    });
    return launchActive && (await recent.isVisible()) ? 'launch-ready' : 'pending';
}

async function recordingSnapshot(page: Page, trackId: string): Promise<RecordingSnapshot | null> {
    return page.evaluate(async (id) => {
        const [{ trackStore }, { takeLaneStore }, { audioBufferCache }] = await Promise.all([
            import('/src/modules/Arrangement/stores/trackStore.ts'),
            import('/src/modules/Arrangement/stores/takeLaneStore.ts'),
            import('/src/modules/AudioEngine/stores/audioBufferCache.ts'),
        ]);
        const track = trackStore.value?.tracks.find((entry) => entry.id === id);
        const clip = track?.clips.find((entry) => entry.type === 'audio' && entry.audioBufferId);
        const lane = takeLaneStore.value?.lanes.find((entry) => entry.trackId === id);
        if (!clip?.audioBufferId || !lane) {
            return null;
        }
        const buffer = audioBufferCache.get(clip.audioBufferId);
        return {
            clipId: clip.id,
            bufferId: clip.audioBufferId,
            clipStartBeat: clip.startBeat,
            clipEndBeat: clip.endBeat,
            takes: lane.takes.map((take) => ({ ...take })),
            regions: lane.activeCompRegions.map((region) => ({ ...region })),
            durationSeconds: buffer?.duration ?? 0,
        };
    }, trackId);
}

async function recordedEnvelope(page: Page, bufferId: string): Promise<number[]> {
    return page.evaluate(async (id) => {
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/audioBufferCache.ts');
        const buffer = audioBufferCache.get(id);
        if (!buffer) {
            return [];
        }
        const data = buffer.getChannelData(0);
        const block = Math.round(buffer.sampleRate * 0.1);
        const result: number[] = [];
        for (let offset = 0; offset + block <= data.length; offset += block) {
            let power = 0;
            for (let frame = offset; frame < offset + block; frame++) {
                power += data[frame] * data[frame];
            }
            result.push(Math.sqrt(power / block));
        }
        return result;
    }, bufferId);
}

async function createCompRegion(
    page: Page,
    take: CapturedTake,
    startBeat: number,
    endBeat: number,
    minBeat: number,
    maxBeat: number
): Promise<void> {
    const button = page.getByRole('button', { name: `Promote ${take.name} to main take` });
    const strip = button.locator('..').locator('[role="presentation"]');
    const box = await strip.boundingBox();
    if (!box) {
        throw new Error(`Take ${take.name} has no visible comp strip`);
    }
    expect(box.width, `Take ${take.name} needs a usable comp strip`).toBeGreaterThan(100);
    const x = (beat: number) => box.x + ((beat - minBeat) / (maxBeat - minBeat)) * box.width;
    const y = box.y + box.height / 2;
    await page.mouse.move(x(startBeat), y);
    await page.mouse.down();
    await page.mouse.move(x(endBeat), y, { steps: 8 });
    await page.mouse.up();
}

async function widenTrackListForComp(page: Page, take: CapturedTake): Promise<void> {
    const separator = page.locator('[data-onboarding="track-list"] + [role="separator"][aria-orientation="vertical"]');
    const box = await separator.boundingBox();
    if (!box) {
        throw new Error('Track list has no visible resize handle');
    }
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(100, box.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 180, y, { steps: 8 });
    await page.mouse.up();

    const strip = page
        .getByRole('button', { name: `Promote ${take.name} to main take` })
        .locator('..')
        .locator('[role="presentation"]');
    await expect.poll(async () => (await strip.boundingBox())?.width ?? 0).toBeGreaterThan(100);
}

async function takeRowBeatRange(page: Page, trackId: string): Promise<{ minBeat: number; maxBeat: number }> {
    return page.evaluate(async (id) => {
        const { trackStore } = await import('/src/modules/Arrangement/stores/trackStore.ts');
        const clips = trackStore.value?.tracks.find((track) => track.id === id)?.clips ?? [];
        if (clips.length !== 1) {
            throw new Error(`Expected one captured clip for the take-row scale; found ${clips.length}`);
        }
        const minBeat = Math.max(0, clips[0]!.startBeat);
        return { minBeat, maxBeat: Math.max(clips[0]!.endBeat, minBeat + 4) };
    }, trackId);
}

async function seek(page: Page, beat: number): Promise<void> {
    await page.evaluate(async (targetBeat) => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        await executeAppAction({ type: 'seekPlayhead', payload: { beat: targetBeat } }, { skipUndo: true });
    }, beat);
}

async function nativeStarts(page: Page): Promise<NativeStart[]> {
    return page.evaluate(() => (Reflect.get(window, '__punchStarts') as NativeStart[]).slice());
}

async function prepareRecordedBufferObserver(page: Page, bufferId: string): Promise<void> {
    await page.evaluate(async (id) => {
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/audioBufferCache.ts');
        const buffer = audioBufferCache.get(id);
        if (!buffer) {
            throw new Error(`Recorded buffer ${id} is absent from the live audio cache`);
        }
        Reflect.set(window, '__punchRecordedBuffer', buffer);
        Reflect.set(window, '__punchStarts', []);
    }, bufferId);
}

async function selectedSourcePositions(page: Page, trackId: string) {
    return page.evaluate(
        async ({ id, bpm }) => {
            const { resolveClipsWithComping } = await import('/src/modules/Arrangement/useCases/resolveComping.ts');
            const { trackStore } = await import('/src/modules/Arrangement/stores/trackStore.ts');
            const clips = trackStore.value?.tracks.find((entry) => entry.id === id)?.clips ?? [];
            return resolveClipsWithComping(id, clips)
                .filter((clip) => clip.type === 'audio' && clip.regionEndBeat > clip.regionStartBeat)
                .map((clip) => ({
                    startBeat: clip.regionStartBeat,
                    endBeat: clip.regionEndBeat,
                    sourceSeconds: ((clip.audioOffsetBeats ?? 0) * 60) / bpm,
                }));
        },
        { id: trackId, bpm: TEMPO }
    );
}

function wavRmsAt(bytes: Buffer, seconds: number): number {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Export did not produce a RIFF/WAVE file');
    }
    const channels = bytes.readUInt16LE(22);
    const rate = bytes.readUInt32LE(24);
    const bits = bytes.readUInt16LE(34);
    if (channels !== 2 || bits !== 24 || rate !== 44_100) {
        throw new Error(`Unexpected export PCM: ${channels} channels, ${bits} bits, ${rate} Hz`);
    }
    let dataOffset = 0;
    let cursor = 12;
    while (cursor + 8 <= bytes.length) {
        const size = bytes.readUInt32LE(cursor + 4);
        if (bytes.toString('ascii', cursor, cursor + 4) === 'data') {
            dataOffset = cursor + 8;
            break;
        }
        cursor += 8 + size + (size % 2);
    }
    if (!dataOffset) {
        throw new Error('Export WAV has no data chunk');
    }
    const start = Math.round((seconds - 0.04) * rate);
    const frames = Math.round(0.08 * rate);
    let power = 0;
    for (let frame = start; frame < start + frames; frame++) {
        const sampleOffset = dataOffset + frame * channels * 3;
        if (sampleOffset < dataOffset || sampleOffset + channels * 3 > bytes.length) {
            throw new Error('Export WAV is shorter than the comp phrase');
        }
        let sample = bytes.readUIntLE(sampleOffset, 3);
        if (sample >= 0x80_0000) {
            sample -= 0x100_0000;
        }
        power += (sample / 0x80_0000) ** 2;
    }
    return Math.sqrt(power / frames);
}

async function exportWav(page: Page): Promise<Buffer> {
    await page.keyboard.press(`${MODIFIER}+Shift+E`);
    const bakery = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(bakery).toBeVisible();
    await expect(bakery.getByRole('radio', { name: 'Whole project' })).toBeChecked();
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await bakery.getByRole('button', { name: 'Start Baking' }).click();
    const result = await download;
    expect(await result.failure()).toBeNull();
    const path = await result.path();
    if (!path) {
        throw new Error('Playwright did not retain the exported WAV');
    }
    await bakery.getByRole('button', { name: 'Close Bakery' }).click();
    return readFile(path);
}

async function sourceRmsAtSelectedBeats(
    page: Page,
    trackId: string,
    bufferId: string,
    beats: number[],
    sourceRate: number
): Promise<number[]> {
    return page.evaluate(
        async ({ id, audioId, points, playbackRate, bpm }) => {
            const [{ resolveClipsWithComping }, { trackStore }, { audioBufferCache }] = await Promise.all([
                import('/src/modules/Arrangement/useCases/resolveComping.ts'),
                import('/src/modules/Arrangement/stores/trackStore.ts'),
                import('/src/modules/AudioEngine/stores/audioBufferCache.ts'),
            ]);
            const clips = trackStore.value?.tracks.find((entry) => entry.id === id)?.clips ?? [];
            const resolved = resolveClipsWithComping(id, clips);
            const buffer = audioBufferCache.get(audioId);
            if (!buffer) {
                throw new Error('Recorded PCM disappeared before export comparison');
            }
            const samples = buffer.getChannelData(0);
            return points.map((beat) => {
                const fragment = resolved.find((clip) => clip.regionStartBeat <= beat && beat < clip.regionEndBeat);
                if (!fragment || fragment.type !== 'audio') {
                    throw new Error(`No comp source covers beat ${beat}`);
                }
                const offsetSeconds = ((fragment.audioOffsetBeats ?? 0) * 60) / bpm;
                const sourceSeconds = offsetSeconds + ((beat - fragment.regionStartBeat) * 60 * playbackRate) / bpm;
                const center = Math.round(sourceSeconds * buffer.sampleRate);
                const radius = Math.round(0.04 * buffer.sampleRate * playbackRate);
                let power = 0;
                for (let frame = center - radius; frame < center + radius; frame++) {
                    if (frame < 0 || frame >= samples.length) {
                        throw new Error(`Comp source at beat ${beat} leaves captured PCM`);
                    }
                    power += samples[frame] * samples[frame];
                }
                return Math.sqrt(power / (2 * radius));
            });
        },
        { id: trackId, audioId: bufferId, points: beats, playbackRate: sourceRate, bpm: TEMPO }
    );
}

async function compareExportWithSelectedPhrase(
    page: Page,
    trackId: string,
    bufferId: string,
    sourceRate: number
): Promise<number> {
    const snapshot = await recordingSnapshot(page, trackId);
    if (!snapshot || snapshot.regions.length !== 3) {
        throw new Error('The three selected comp intervals are absent before export');
    }
    const positions = (await selectedSourcePositions(page, trackId)).filter((position) =>
        snapshot.regions.some((region) => Math.abs(position.startBeat - region.startBeat) < 0.01)
    );
    const points = positions.flatMap((fragment) => {
        const result: number[] = [];
        for (let beat = fragment.startBeat + 0.15; beat < fragment.endBeat - 0.15; beat += 0.1) {
            result.push(beat);
        }
        return result;
    });
    expect(points.length).toBeGreaterThanOrEqual(8);
    const source = await sourceRmsAtSelectedBeats(page, trackId, bufferId, points, sourceRate);
    const wav = await exportWav(page);
    const rendered = points.map((beat) => wavRmsAt(wav, (beat * 60) / TEMPO));
    const score = correlation(source, rendered);
    expect(score, 'export PCM must follow the selected recorded phrase at each comp interval').toBeGreaterThan(0.6);
    return score;
}

test('records real microphone PCM through punch-loop passes, comps it, undoes, exports, and reopens', async ({}, testInfo: TestInfo) => {
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== 'string') {
        throw new Error('Punch acceptance needs a private Playwright baseURL');
    }
    const micWav = testInfo.outputPath('timecoded-fake-microphone.wav');
    await writeFile(micWav, fakeMicrophoneWav());
    const browser = await chromium.launch({
        channel: 'chromium',
        headless: true,
        args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micWav}`],
    });
    let activePage: Page | undefined;
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let completed = false;
    const browserConsole: { page: string; type: string; text: string }[] = [];
    const observeConsole = (page: Page, label: string): void => {
        page.on('console', (message) => {
            browserConsole.push({ page: label, type: message.type(), text: message.text() });
        });
        page.on('pageerror', (error) => {
            browserConsole.push({ page: label, type: 'pageerror', text: error.stack ?? error.message });
        });
    };
    try {
        context = await browser.newContext({
            baseURL,
            permissions: ['microphone'],
            acceptDownloads: true,
            serviceWorkers: 'block',
            viewport: { width: 1440, height: 900 },
        });
        context.setDefaultTimeout(30_000);
        context.setDefaultNavigationTimeout(45_000);
        const page = await context.newPage();
        activePage = page;
        observeConsole(page, 'initial');
        await installNativePlaybackObserver(page);
        await installDownloadFallback(page);
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Untitled Project' }).click();
        await page.locator('input:focus').fill(PROJECT_NAME);
        await page.locator('input:focus').press('Enter');

        const trackId = await page.evaluate(
            async ({ loopStart, loopEnd, punchIn, punchOut }) => {
                const [{ executeAppAction }, { trackStore }] = await Promise.all([
                    import('/src/modules/Command/useCases/index.ts'),
                    import('/src/modules/Arrangement/stores/trackStore.ts'),
                ]);
                await executeAppAction(
                    { type: 'addTrack', payload: { name: 'Punch mic', kind: 'audio' } },
                    { skipUndo: true }
                );
                const track = trackStore.value?.tracks.find(
                    (entry) => entry.name === 'Punch mic' && entry.kind === 'audio'
                );
                if (!track) {
                    throw new Error('Typed addTrack did not create the Punch mic audio track');
                }
                await executeAppAction(
                    { type: 'armTrack', payload: { trackId: track.id, armed: true } },
                    { skipUndo: true }
                );
                await executeAppAction(
                    { type: 'setLoopRegion', payload: { startBeat: loopStart, endBeat: loopEnd } },
                    { skipUndo: true }
                );
                await executeAppAction({ type: 'setPunchIn', payload: { beat: punchIn } }, { skipUndo: true });
                await executeAppAction({ type: 'setPunchOut', payload: { beat: punchOut } }, { skipUndo: true });
                await executeAppAction({ type: 'seekPlayhead', payload: { beat: 9 } }, { skipUndo: true });
                return track.id;
            },
            { loopStart: LOOP_START, loopEnd: LOOP_END, punchIn: PUNCH_IN, punchOut: PUNCH_OUT }
        );
        const defaultInputId = await page.evaluate(async (id) => {
            const { trackStore } = await import('/src/modules/Arrangement/stores/trackStore.ts');
            return trackStore.value?.tracks.find((entry) => entry.id === id)?.inputId;
        }, trackId);
        expect(defaultInputId, 'the armed audio track must capture the browser default microphone').toBeNull();
        await expect(page.getByTestId(`track-arm-${trackId}`)).toHaveAttribute('aria-label', 'Disarm Punch mic');
        const monitor = page.getByRole('button', { name: /^Input monitoring:/ });
        for (
            let attempt = 0;
            attempt < 3 && (await monitor.getAttribute('aria-label')) !== 'Input monitoring: Off';
            attempt++
        ) {
            await monitor.click();
        }
        await expect(monitor).toHaveAttribute('aria-label', 'Input monitoring: Off');
        const trackRow = page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .filter({ hasText: 'Punch mic' });
        await trackRow.getByRole('button', { name: 'Toggle variation lanes' }).click();
        await page.getByTestId('transport-loop').click();
        await expect(page.getByTestId('transport-loop')).toHaveAttribute('aria-pressed', 'true');
        await page.getByTestId('transport-punch').click();
        await expect(page.getByTestId('transport-punch')).toHaveAttribute('aria-pressed', 'true');
        await expect
            .poll(async () =>
                page.evaluate(async () => {
                    const { transportStore } = await import('/src/modules/Transport/stores/transportStore.ts');
                    return transportStore.value?.tempo;
                })
            )
            .toBe(TEMPO);

        await page.getByTestId('transport-record').click();
        await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
        await expect
            .poll(
                async () =>
                    page.evaluate(async (id) => {
                        const { activeSessions } =
                            await import('/src/modules/AudioEngine/repositories/audioRecorder/recordingSession.ts');
                        return activeSessions.get(id)?.status ?? null;
                    }, trackId),
                { timeout: 20_000 }
            )
            .toBe('recording');
        await expect
            .poll(
                async () =>
                    page.evaluate(async () => {
                        const { playheadWrapCountRef } =
                            await import('/src/modules/Transport/stores/playheadWrapCountRef.ts');
                        return playheadWrapCountRef.current;
                    }),
                { timeout: 25_000 }
            )
            .toBeGreaterThanOrEqual(2);
        await expect
            .poll(
                async () =>
                    page.evaluate(async () => {
                        const [{ playheadWrapCountRef }, { playheadClockRef }] = await Promise.all([
                            import('/src/modules/Transport/stores/playheadWrapCountRef.ts'),
                            import('/src/modules/Transport/stores/playheadClockRef.ts'),
                        ]);
                        return (
                            playheadWrapCountRef.current === 2 &&
                            playheadClockRef.beat >= 9 &&
                            playheadClockRef.beat < 11
                        );
                    }),
                { timeout: 4_000 }
            )
            .toBe(true);
        await page.getByTestId('transport-stop').click();
        await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'false');
        await expect
            .poll(async () => (await recordingSnapshot(page, trackId))?.takes.length ?? 0, { timeout: 30_000 })
            .toBe(3);
        const captured = await recordingSnapshot(page, trackId);
        if (!captured) {
            throw new Error('Recorder committed no audio clip and take lane');
        }
        expect(captured.durationSeconds).toBeGreaterThan(3);
        expect(captured.clipStartBeat).toBeGreaterThanOrEqual(LOOP_START - 0.2);
        expect(captured.clipEndBeat).toBeLessThanOrEqual(LOOP_END + 0.2);
        const passes = [...captured.takes].sort((a, b) => (a.passDepthSeconds ?? -1) - (b.passDepthSeconds ?? -1));
        expect(
            passes.every((take) => take.passDepthSeconds !== undefined && take.passSourceEndSeconds !== undefined)
        ).toBe(true);
        expect(passes[0].passDepthSeconds!).toBeGreaterThanOrEqual(0);
        expect(passes[1].passDepthSeconds!).toBeGreaterThan(passes[0].passDepthSeconds! + 0.5);
        expect(passes[2].passDepthSeconds!).toBeGreaterThan(passes[1].passDepthSeconds! + 1);
        expect(passes[0].startBeat).toBeGreaterThanOrEqual(PUNCH_IN - 0.2);
        expect(passes[0].endBeat).toBeCloseTo(LOOP_END, 0);
        expect(passes[1].startBeat).toBeCloseTo(LOOP_START, 0);
        expect(passes[1].endBeat).toBeCloseTo(LOOP_END, 0);
        expect(passes[2].startBeat).toBeCloseTo(LOOP_START, 0);
        expect(passes[2].endBeat).toBeGreaterThan(9);
        expect(passes[2].endBeat).toBeLessThan(LOOP_END);
        expect(passes.every((take) => take.passSourceEndSeconds! <= captured.durationSeconds + 0.1)).toBe(true);
        const envelope = await recordedEnvelope(page, captured.bufferId);
        expect(envelope.length).toBeGreaterThan(30);
        expect(Math.max(...envelope)).toBeGreaterThan(0.02);
        expect(
            bestMicTimecodeMatch(envelope),
            'committed PCM must match the timecoded WAV fed to native getUserMedia'
        ).toBeGreaterThan(0.45);

        await page.getByTestId('transport-undo').click();
        await expect.poll(async () => (await recordingSnapshot(page, trackId))?.takes.length ?? 0).toBe(0);
        await page.getByTestId('transport-redo').click();
        await expect.poll(async () => (await recordingSnapshot(page, trackId))?.takes.length ?? 0).toBe(3);
        const restored = await recordingSnapshot(page, trackId);
        expect(restored?.clipId).toBe(captured.clipId);
        expect(restored?.bufferId).toBe(captured.bufferId);
        expect(restored?.takes).toEqual(captured.takes);

        await widenTrackListForComp(page, passes[0]);
        const compRange = await takeRowBeatRange(page, trackId);
        expect(compRange).toEqual({ minBeat: captured.clipStartBeat, maxBeat: captured.clipEndBeat });
        for (const take of passes) {
            const promote = page.getByRole('button', { name: `Promote ${take.name} to main take` });
            await promote.click();
            await expect(promote).toHaveAttribute('aria-pressed', 'true');
        }
        const compPlan = [
            { take: passes[2], start: 8.25, end: 9 },
            { take: passes[1], start: 9.25, end: 10 },
            { take: passes[0], start: 10.25, end: 11 },
        ];
        await page.evaluate(() => {
            const events: { type: string; phase: string; stripTarget: boolean; rowDraggable: boolean }[] = [];
            Reflect.set(window, '__punchCompGestureEvents', events);
            for (const type of ['mousedown', 'mousemove', 'mouseup', 'dragstart', 'drag', 'dragend', 'drop']) {
                for (const capture of [true, false]) {
                    document.addEventListener(
                        type,
                        (event) => {
                            if (events.length >= 200) return;
                            const target = event.target instanceof Element ? event.target : null;
                            const row = target?.closest('[role="row"]');
                            if (!row) return;
                            events.push({
                                type,
                                phase: capture ? 'capture' : 'bubble',
                                stripTarget: Boolean(target?.closest('[role="presentation"]')),
                                rowDraggable: row.getAttribute('draggable') === 'true',
                            });
                        },
                        capture
                    );
                }
            }
        });
        for (const region of compPlan) {
            await createCompRegion(page, region.take, region.start, region.end, compRange.minBeat, compRange.maxBeat);
        }
        const compEvents = await page.evaluate(
            () =>
                Reflect.get(window, '__punchCompGestureEvents') as {
                    type: string;
                    phase: string;
                    stripTarget: boolean;
                    rowDraggable: boolean;
                }[]
        );
        await writeFile(testInfo.outputPath('comp-gesture-events.json'), JSON.stringify(compEvents, null, 2));
        expect(compEvents.filter((event) => event.type === 'dragstart' && event.rowDraggable)).toHaveLength(0);
        expect(
            compEvents.filter((event) => event.type === 'mouseup' && event.phase === 'bubble' && event.stripTarget)
        ).toHaveLength(3);
        await expect.poll(async () => (await recordingSnapshot(page, trackId))?.regions.length ?? 0).toBe(3);
        const comped = await recordingSnapshot(page, trackId);
        if (!comped) {
            throw new Error('Comp regions disappeared after the UI drag');
        }
        for (const [index, expected] of compPlan.entries()) {
            const region = comped?.regions[index];
            expect(region?.takeId).toBe(expected.take.id);
            expect(region?.startBeat).toBeCloseTo(expected.start, 1);
            expect(region?.endBeat).toBeCloseTo(expected.end, 1);
        }
        await expect(page.locator('[title^="Comp:"]')).toHaveCount(3);

        await prepareRecordedBufferObserver(page, captured.bufferId);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        const positions = await selectedSourcePositions(page, trackId);
        const expectedOffsets = positions
            .filter((position) => compPlan.some((region) => Math.abs(region.start - position.startBeat) < 0.1))
            .map((position) => position.sourceSeconds);
        expect(expectedOffsets).toHaveLength(3);
        await expect
            .poll(
                async () => {
                    const starts = (await nativeStarts(page)).filter((entry) => entry.recordedBuffer);
                    return expectedOffsets.filter((offset) =>
                        starts.some((entry) => Math.abs(entry.offsetSeconds - offset) < 0.35)
                    ).length;
                },
                { timeout: 8_000 }
            )
            .toBe(3);
        await page.getByTestId('transport-stop').click();
        const starts = await nativeStarts(page);
        expect(starts.some((entry) => entry.recordedBuffer && (entry.durationSeconds ?? 0) > 0)).toBe(true);
        for (const region of comped.regions) {
            const take = passes.find((entry) => entry.id === region.takeId);
            const resolved = positions.find((entry) => Math.abs(entry.startBeat - region.startBeat) < 0.1);
            const started = starts.find(
                (entry) =>
                    entry.recordedBuffer && resolved && Math.abs(entry.offsetSeconds - resolved.sourceSeconds) < 0.35
            );
            expect(take).toBeDefined();
            expect(started).toBeDefined();
            expect(started!.offsetSeconds).toBeGreaterThanOrEqual(take!.passDepthSeconds! - 0.35);
            expect(started!.offsetSeconds + started!.durationSeconds!).toBeLessThanOrEqual(
                take!.passSourceEndSeconds! + 0.35
            );
        }
        const normalExportScore = await compareExportWithSelectedPhrase(page, trackId, captured.bufferId, 1);

        await page.evaluate(async (clipId) => {
            const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
            await executeAppAction({ type: 'setClipStretchMode', payload: { clipId, mode: 'repitch' } });
            await executeAppAction({ type: 'setClipStretchRatio', payload: { clipId, ratio: 1.1 } });
        }, captured.clipId);
        await prepareRecordedBufferObserver(page, captured.bufferId);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        await expect
            .poll(async () => (await nativeStarts(page)).filter((entry) => entry.recordedBuffer).length, {
                timeout: 8_000,
            })
            .toBeGreaterThanOrEqual(3);
        await page.getByTestId('transport-stop').click();
        const stretchExportScore = await compareExportWithSelectedPhrase(page, trackId, captured.bufferId, 1.1);

        const projectId = await page.evaluate(async () => {
            const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
            return projectStore.value?.projectId;
        });
        expect(projectId).toBeTruthy();
        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(page.getByTitle('Unsaved changes')).toHaveCount(0, { timeout: 30_000 });
        await page.close();

        const reopened = await context.newPage();
        activePage = reopened;
        observeConsole(reopened, 'reopened');
        await installNativePlaybackObserver(reopened);
        await installDownloadFallback(reopened);
        const bootTimeline = attach_first_paint_console(reopened);
        await reopened.goto('/');
        await wait_for_console_marker(bootTimeline, CAPABILITIES_MARKER, 30_000);
        await expect
            .poll(() => settledReopenMode(reopened, projectId!), { timeout: 30_000 })
            .toMatch(/^(saved-active|launch-ready)$/);
        if ((await settledReopenMode(reopened, projectId!)) === 'launch-ready') {
            await wait_for_launch_first_paint(reopened);
            const recent = reopened.getByRole('button', { name: `Open recent project ${PROJECT_NAME}` });
            await expect(recent).toBeVisible();
            await recent.click();
        }
        await wait_for_workspace_ready(reopened);
        await expect
            .poll(
                async () =>
                    reopened.evaluate(async () => {
                        const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
                        const state = projectStore.value;
                        return state?.initialized === true && state.loading === false ? state.projectId : null;
                    }),
                { timeout: 30_000 }
            )
            .toBe(projectId);
        await expect(reopened.getByTestId('project-name')).toHaveText(PROJECT_NAME);
        await expect(
            reopened
                .getByRole('grid', { name: /Track list/i })
                .first()
                .getByText('Punch mic', { exact: true })
        ).toBeVisible();
        await expect
            .poll(async () => (await recordingSnapshot(reopened, trackId))?.durationSeconds ?? 0, { timeout: 30_000 })
            .toBeGreaterThan(3);
        const persisted = await recordingSnapshot(reopened, trackId);
        expect(persisted?.clipId).toBe(captured.clipId);
        expect(persisted?.bufferId).toBe(captured.bufferId);
        expect(persisted?.takes.map((take) => take.id)).toEqual(captured.takes.map((take) => take.id));
        expect(persisted?.regions).toEqual(comped?.regions);
        await prepareRecordedBufferObserver(reopened, captured.bufferId);
        await seek(reopened, LOOP_START);
        await reopened.getByTestId('transport-play').click();
        await expect
            .poll(async () => (await nativeStarts(reopened)).filter((entry) => entry.recordedBuffer).length, {
                timeout: 8_000,
            })
            .toBeGreaterThanOrEqual(3);
        await reopened.getByTestId('transport-stop').click();
        const reopenedExportScore = await compareExportWithSelectedPhrase(reopened, trackId, captured.bufferId, 1.1);
        await testInfo.attach('punch-loop-acceptance-evidence', {
            body: JSON.stringify(
                {
                    projectId,
                    trackId,
                    clipId: captured.clipId,
                    bufferId: captured.bufferId,
                    passes,
                    regions: comped?.regions,
                    micTimecodeCorrelation: bestMicTimecodeMatch(envelope),
                    normalExportScore,
                    stretchExportScore,
                    reopenedExportScore,
                },
                null,
                2
            ),
            contentType: 'application/json',
        });
        completed = true;
    } finally {
        if (!completed && activePage && !activePage.isClosed()) {
            await activePage
                .screenshot({ path: testInfo.outputPath('failure.png'), fullPage: true })
                .catch(() => undefined);
        }
        await writeFile(testInfo.outputPath('browser-console.json'), JSON.stringify(browserConsole, null, 2)).catch(
            () => undefined
        );
        try {
            await context?.close();
        } finally {
            await browser.close();
        }
    }
});
