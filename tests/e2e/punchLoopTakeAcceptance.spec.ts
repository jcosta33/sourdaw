// Browser-carrier acceptance: these Web Audio observations do not authenticate a Rust device clock.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { chromium, expect, test, type Page, type TestInfo } from '@playwright/test';

import { launch_new_project, setupWorkspace, wait_for_launch_first_paint, wait_for_workspace_ready } from './e2eUtils';
import { attach_first_paint_console, CAPABILITIES_MARKER, wait_for_console_marker } from './firstPaintDiagnostics';
import { installFilePickerCapture } from './exportFilePickerCapture';
import {
    bindPunchRecordingClockWitness,
    captureFrameDrift,
    compensatedCaptureFrontierBeat,
    currentPunchRecordingClock,
    finalCapturedFrames,
    frozenRecordingLatency,
    installPunchRecordingClockWitness,
    readPunchRecordingClockWitness,
    RECORDING_RENDER_QUANTUM_FRAMES,
    stopClockEvent,
    type PunchRecordingClockWitness,
} from './punchRecordingClockWitness';

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
const CAPTURE_FRONTIER_BOUND_BEATS = (2 * RECORDING_RENDER_QUANTUM_FRAMES * TEMPO) / (MIC_SAMPLE_RATE * 60);

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

type BrowserSourceStart = { offsetSeconds: number; durationSeconds: number | null; recordedBuffer: boolean };

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

async function installBrowserPlaybackObserver(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const nativeStart = AudioBufferSourceNode.prototype.start;
        Reflect.set(window, '__punchStarts', []);
        AudioBufferSourceNode.prototype.start = function (...args): void {
            const starts = Reflect.get(window, '__punchStarts') as BrowserSourceStart[];
            starts.push({
                offsetSeconds: args[1] ?? 0,
                durationSeconds: args[2] ?? null,
                recordedBuffer: this.buffer === Reflect.get(window, '__punchRecordedBuffer'),
            });
            Reflect.apply(nativeStart, this, args);
        };
    });
}

async function settledReopenMode(
    page: Page,
    savedProjectId: string,
    projectName = PROJECT_NAME
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
    const recent = page.getByRole('button', { name: `Open recent project ${projectName}` });
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
            takes: lane.takes,
            regions: lane.activeCompRegions,
            durationSeconds: buffer?.duration ?? 0,
        };
    }, trackId);
}

async function expectNoAuditionRecording(page: Page, trackId: string, takeIds: string[]): Promise<void> {
    await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'false');
    const sessionStatus = await page.evaluate(async (id) => {
        const { activeSessions } =
            await import('/src/modules/AudioEngine/repositories/audioRecorder/recordingSession.ts');
        return activeSessions.get(id)?.status ?? null;
    }, trackId);
    expect(sessionStatus, 'an audition must not open a recording session').toBeNull();
    expect(
        (await recordingSnapshot(page, trackId))?.takes.map((take) => take.id),
        'an audition must keep the original recorded take IDs'
    ).toEqual(takeIds);
}

async function recordedEnvelope(page: Page, bufferId: string | null): Promise<number[]> {
    return page.evaluate(async (id) => {
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/audioBufferCache.ts');
        let buffer: AudioBuffer | undefined;
        if (id) {
            buffer = audioBufferCache.get(id);
        } else {
            buffer = Reflect.get(window, '__punchClosingBuffer');
        }
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

async function browserStarts(page: Page): Promise<BrowserSourceStart[]> {
    return page.evaluate(() => (Reflect.get(window, '__punchStarts') as BrowserSourceStart[]).slice());
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

function expectFiniteSourceStarts(
    starts: BrowserSourceStart[],
    positions: Awaited<ReturnType<typeof selectedSourcePositions>>,
    regions: RecordingSnapshot['regions'],
    passes: CapturedTake[]
): void {
    for (const region of regions) {
        const take = passes.find((entry) => entry.id === region.takeId);
        const resolved = positions.find((entry) => Math.abs(entry.startBeat - region.startBeat) < 0.1);
        const started = starts.find(
            (entry) => entry.recordedBuffer && resolved && Math.abs(entry.offsetSeconds - resolved.sourceSeconds) < 0.35
        );
        expect(take, 'every comp region must own a captured pass').toBeDefined();
        expect(started, 'every selected pass must reach the actual Web Audio start').toBeDefined();
        expect(started!.durationSeconds).toBeGreaterThan(0);
        expect(started!.offsetSeconds).toBeGreaterThanOrEqual(take!.passDepthSeconds! - 0.35);
        expect(started!.offsetSeconds + started!.durationSeconds!).toBeLessThanOrEqual(
            take!.passSourceEndSeconds! + 0.35
        );
    }
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
    const capture = await installFilePickerCapture(page, test.info().outputPath(`punch-loop-${randomUUID()}.wav`));
    try {
        await page.keyboard.press(`${MODIFIER}+Shift+E`);
        const bakery = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        await expect(bakery).toBeVisible();
        await expect(bakery.getByRole('radio', { name: 'Whole project' })).toBeChecked();
        const pickerFilename = capture.pickerFilename;
        await bakery.getByRole('button', { name: 'Start Baking' }).click();
        await expect(bakery.getByRole('button', { name: 'Close Bakery' })).toBeVisible({ timeout: 120_000 });
        await capture.waitForClose();

        expect(await pickerFilename).toMatch(/^Sourdaw_Bake_\d+\.wav$/);
        expect(capture.writeCount()).toBeGreaterThan(0);
        expect(capture.bytesWritten()).toBeGreaterThan(0);
        expect(capture.abortCount()).toBe(0);
        const bytes = await readFile(capture.path);
        await bakery.getByRole('button', { name: 'Close Bakery' }).click();
        return bytes;
    } finally {
        await capture.dispose();
    }
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
    expect(positions).toHaveLength(3);
    const points = positions.flatMap((fragment) => {
        const result: number[] = [];
        for (let beat = fragment.startBeat + 0.15; beat < fragment.endBeat - 0.15; beat += 0.1) {
            result.push(beat);
        }
        expect(result.length, 'every selected pass must contribute an export PCM probe').toBeGreaterThan(0);
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

async function recordingOwners(page: Page, trackId: string) {
    return page.evaluate(async (id) => {
        const [{ trackStore }, { takeLaneStore }, { getCrdtDoc }] = await Promise.all([
            import('/src/modules/Arrangement/stores/trackStore.ts'),
            import('/src/modules/Arrangement/stores/takeLaneStore.ts'),
            import('/src/modules/CrdtDocument/useCases/index.ts'),
        ]);
        const root = getCrdtDoc<{
            tracks?: typeof trackStore.value;
            takeLanes?: typeof takeLaneStore.value;
        }>('root');
        const select = (tracks: typeof trackStore.value, lanes: typeof takeLaneStore.value) => ({
            clips: (tracks?.tracks.find((track) => track.id === id)?.clips ?? []).map((clip) => ({
                id: clip.id,
                bufferId: clip.audioBufferId ?? null,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
            })),
            lanes: (lanes?.lanes.filter((lane) => lane.trackId === id) ?? []).map((lane) => ({
                id: lane.id,
                trackId: lane.trackId,
                takes: lane.takes,
                regions: lane.activeCompRegions,
            })),
        });
        if (!root) {
            throw new Error('The active project has no authoritative root document');
        }
        return {
            raw: select(root.tracks ?? null, root.takeLanes ?? null),
            projected: select(trackStore.value, takeLaneStore.value),
        };
    }, trackId);
}

async function pcmFingerprint(page: Page, bufferId: string | null) {
    return page.evaluate(async (id) => {
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/audioBufferCache.ts');
        let buffer: AudioBuffer | undefined;
        if (id) {
            buffer = audioBufferCache.get(id);
        } else {
            buffer = Reflect.get(window, '__punchClosingBuffer');
        }
        if (!buffer) {
            throw new Error('The original captured PCM is unavailable for the durability comparison');
        }
        const bytes = new Uint8Array(buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            bytes.set(
                new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
                channel * samples.byteLength
            );
        }
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return {
            sampleRate: buffer.sampleRate,
            frames: buffer.length,
            channels: buffer.numberOfChannels,
            sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
        };
    }, bufferId);
}

async function readyProjectId(page: Page): Promise<string | null> {
    return page.evaluate(async () => {
        const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
        const state = projectStore.value;
        return state?.initialized && !state.loading && state.projectId ? state.projectId : null;
    });
}

async function reopenRecentProject(page: Page, projectId: string, projectName: string): Promise<void> {
    const boot = attach_first_paint_console(page);
    await page.goto('/');
    await wait_for_console_marker(boot, CAPABILITIES_MARKER, 30_000);
    const readMode = async () => {
        const mode = await settledReopenMode(page, projectId, projectName);
        return mode === 'wrong-active' ? 'workspace' : mode;
    };
    await expect.poll(readMode, { timeout: 30_000 }).toMatch(/^(saved-active|launch-ready|workspace)$/);
    const mode = await settledReopenMode(page, projectId, projectName);
    if (mode === 'launch-ready') {
        await wait_for_launch_first_paint(page);
        const recent = page.getByRole('button', { name: `Open recent project ${projectName}` });
        await expect(recent).toBeVisible();
        await recent.click();
    } else {
        expect(mode, 'fresh page must expose a real workspace or launch Recent entry').toMatch(
            /^(saved-active|wrong-active)$/
        );
        await wait_for_workspace_ready(page);
        await page.getByRole('button', { name: 'Project menu', exact: true }).click();
        const recent = page.getByRole('menuitem').filter({ has: page.getByText(projectName, { exact: true }) });
        await expect(recent).toBeVisible();
        await recent.click();
    }
    await wait_for_workspace_ready(page);
    await expect.poll(() => readyProjectId(page), { timeout: 30_000 }).toBe(projectId);
    await expect(page.getByTestId('project-name')).toHaveText(projectName);
}

async function observeClosingRecording(page: Page, trackId: string, projectId: string): Promise<void> {
    await page.evaluate(
        async ({ id, outgoingProjectId }) => {
            const [
                { trackStore },
                { takeLaneStore },
                { audioBufferCache },
                { projectStore },
                { transportStore },
                { activeSessions },
                { isTransportIdle },
            ] = await Promise.all([
                import('/src/modules/Arrangement/stores/trackStore.ts'),
                import('/src/modules/Arrangement/stores/takeLaneStore.ts'),
                import('/src/modules/AudioEngine/stores/audioBufferCache.ts'),
                import('/src/modules/Project/stores/projectStore.ts'),
                import('/src/modules/Transport/stores/transportStore.ts'),
                import('/src/modules/AudioEngine/repositories/audioRecorder/recordingSession.ts'),
                import('/src/modules/Transport/useCases/index.ts'),
            ]);
            const capture = (): void => {
                if (projectStore.value?.projectId !== outgoingProjectId) {
                    return;
                }
                const clip = trackStore.value?.tracks
                    .find((track) => track.id === id)
                    ?.clips.find((entry) => entry.audioBufferId);
                const lane = takeLaneStore.value?.lanes.find((entry) => entry.trackId === id);
                const buffer = clip?.audioBufferId ? audioBufferCache.get(clip.audioBufferId) : undefined;
                if (
                    !clip?.audioBufferId ||
                    !buffer ||
                    lane?.takes.length !== 3 ||
                    !lane.takes.every((take) => Number.isFinite(take.passSourceEndSeconds))
                ) {
                    return;
                }
                Reflect.set(window, '__punchClosing', {
                    clipId: clip.id,
                    bufferId: clip.audioBufferId,
                    clipStartBeat: clip.startBeat,
                    clipEndBeat: clip.endBeat,
                    takes: lane.takes,
                    regions: lane.activeCompRegions,
                    durationSeconds: buffer.duration,
                });
                // Retain the actual committed AudioBuffer across the product's cache teardown.
                Reflect.set(window, '__punchClosingBuffer', buffer);
            };
            const unsubscribers = [trackStore.subscribe(capture), takeLaneStore.subscribe(capture)];
            let wasPlaying = transportStore.value?.isPlaying === true;
            unsubscribers.push(
                transportStore.subscribe((state) => {
                    if (
                        wasPlaying &&
                        state?.isPlaying === false &&
                        projectStore.value?.projectId === outgoingProjectId
                    ) {
                        const lane = takeLaneStore.value?.lanes.find((entry) => entry.trackId === id);
                        Reflect.set(window, '__punchPause', {
                            projectId: outgoingProjectId,
                            beat: state.playheadPosition,
                            sessionStatus: activeSessions.get(id)?.status ?? null,
                            takeIds: lane?.takes.map((take) => take.id) ?? [],
                        });
                    }
                    wasPlaying = state?.isPlaying === true;
                })
            );
            const requested = (event: Event): void => {
                const target = event.target instanceof Element ? event.target : null;
                if (target?.closest('[data-testid="transport-play"]') && transportStore.value?.isPlaying) {
                    Reflect.set(window, '__punchPauseRequest', {
                        projectId: projectStore.value?.projectId,
                        recording: transportStore.value.isRecording,
                        sessionStatus: activeSessions.get(id)?.status ?? null,
                    });
                }
                if (target?.closest('[data-testid="menu-new-project"]')) {
                    Reflect.set(window, '__punchReplacementRequest', {
                        projectId: projectStore.value?.projectId,
                        idle: isTransportIdle(),
                    });
                }
            };
            document.addEventListener('click', requested, true);
            Reflect.set(window, '__punchUnsubscribe', () => {
                for (const unsubscribe of unsubscribers) {
                    unsubscribe();
                }
                document.removeEventListener('click', requested, true);
            });
        },
        { id: trackId, outgoingProjectId: projectId }
    );
}

async function configurePunchTrack(page: Page): Promise<string> {
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
    return trackId;
}

async function retainPunchFailureDiagnostics(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let snapshot: unknown;
    try {
        snapshot = await Promise.race([
            page.evaluate(async () => {
                const value: unknown = Reflect.get(window, '__punchRecordingClockWitness');
                const state = typeof value === 'object' && value !== null ? value : null;
                const context: unknown = state && 'context' in state ? state.context : null;
                const admissionContext: unknown = state && 'admissionContext' in state ? state.admissionContext : null;
                const control: unknown = state && 'control' in state ? state.control : null;
                const samples: unknown = state && 'samples' in state ? state.samples : null;
                const events: unknown = state && 'events' in state ? state.events : null;
                const contextIds = new Map<AudioContext, number>();
                const describeContext = (candidate: unknown) => {
                    if (!(candidate instanceof AudioContext)) {
                        return null;
                    }
                    let id = contextIds.get(candidate);
                    if (id === undefined) {
                        id = contextIds.size + 1;
                        contextIds.set(candidate, id);
                    }
                    return {
                        id,
                        state: candidate.state,
                        currentTime: candidate.currentTime,
                        sampleRate: candidate.sampleRate,
                        baseLatency: candidate.baseLatency,
                        outputLatency: candidate.outputLatency,
                    };
                };
                const capture = {
                    wallTimeMs: Date.now(),
                    performanceTimeMs: performance.now(),
                    performanceTimeOriginMs: performance.timeOrigin,
                    context: describeContext(context),
                    admissionContext: describeContext(admissionContext),
                    controlWords: control instanceof Int32Array ? Array.from(control) : null,
                    admission: state && 'admission' in state ? state.admission : null,
                    firstFrame: state && 'firstFrame' in state ? state.firstFrame : null,
                    sampleCount: Array.isArray(samples) ? samples.length : null,
                    samples: Array.isArray(samples) ? samples.slice(-512) : null,
                    events: Array.isArray(events) ? events.slice(-64) : null,
                    readDiagnostics: state && 'readDiagnostics' in state ? state.readDiagnostics : null,
                    stopSent: state && 'stopSent' in state ? state.stopSent : null,
                };
                try {
                    const [transport, playhead, wraps, sessions, scheduler, timing, audio] = await Promise.all([
                        import('/src/modules/Transport/stores/transportStore.ts'),
                        import('/src/modules/Transport/stores/playheadClockRef.ts'),
                        import('/src/modules/Transport/stores/playheadWrapCountRef.ts'),
                        import('/src/modules/AudioEngine/repositories/audioRecorder/recordingSession.ts'),
                        import('/src/modules/Transport/useCases/playheadScheduler/schedulerSession.ts'),
                        import('/src/modules/Transport/useCases/playheadScheduler/schedulerTimingDiagnostics.ts'),
                        import('/src/modules/AudioEngine/useCases/engineAccess/getAudioContext.ts'),
                    ]);
                    const session = scheduler.schedulerSession;
                    const engineContext = audio.getAudioContext();
                    return {
                        capture,
                        engineContext: describeContext(engineContext),
                        contextIdentity: {
                            recordingMatchesEngine: context === engineContext,
                            recordingMatchesAdmission: context === admissionContext,
                            admissionMatchesEngine: admissionContext === engineContext,
                        },
                        transport: transport.transportStore.value,
                        playheadBeat: playhead.playheadClockRef.beat,
                        wrapCount: wraps.playheadWrapCountRef.current,
                        recordingSessions: Array.from(sessions.activeSessions, ([trackId, recording]) => ({
                            trackId,
                            status: recording.status,
                            captureSampleRate: recording.captureSampleRate,
                            producerStopAcknowledged: recording.producerStopAcknowledged,
                            decodePending: recording.decodePending,
                            recordingNodeContext: describeContext(recording.recordingNode?.context),
                            sourceNodeContext: describeContext(recording.sourceNode?.context),
                        })).slice(0, 16),
                        scheduler: {
                            generation: session.generation,
                            discontinuityEpoch: session.discontinuityEpoch,
                            workerPresent: session.worker !== null,
                            tickInFlight: session.tickInFlight,
                            lastTickTime: session.lastTickTime,
                            accumulatedPosition: session.accumulatedPosition,
                            lastScheduledBeat: session.lastScheduledBeat,
                            punchRecordingActive: session.punchRecordingActive,
                            pendingSeam: session.pendingSeam,
                            lastLoopSignature: session.lastLoopSignature,
                            activeAudioSources: session.activeAudioSources.length,
                        },
                        timing: timing.schedulerTimingDiagnostics.snapshot(),
                    };
                } catch (error) {
                    return { capture, storeDiagnosticError: String(error) };
                }
            }),
            new Promise<never>((_resolve, reject) => {
                deadline = setTimeout(() => reject(new Error('Punch failure snapshot exceeded 3000 ms')), 3000);
            }),
        ]);
    } catch (error) {
        snapshot = { captureError: String(error), pageClosed: page.isClosed() };
    } finally {
        clearTimeout(deadline);
    }
    const path = testInfo.outputPath(`${name}.json`);
    await writeFile(path, JSON.stringify(snapshot, null, 2));
    await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function recordThroughTwoWraps(page: Page, trackId: string): Promise<void> {
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
                        playheadWrapCountRef.current === 2 && playheadClockRef.beat >= 9 && playheadClockRef.beat < 11
                    );
                }),
            { timeout: 4_000 }
        )
        .toBe(true);
}

async function waitForCapturedThirdPassFrontier(page: Page): Promise<void> {
    await expect
        .poll(
            async () => {
                const current = await currentPunchRecordingClock(page);
                const frame = current.recording;
                const output = current.output;
                if (!frame || frame.sampleZeroContextFrame === null || !output || output.wrapCount !== 2) {
                    return false;
                }
                const drift = captureFrameDrift(frame);
                if (drift === null || Math.abs(drift) > RECORDING_RENDER_QUANTUM_FRAMES) {
                    return false;
                }
                const frontier = compensatedCaptureFrontierBeat({
                    gestureBeat: output.gestureBeat,
                    gestureContextFrame: frame.contextFrame,
                    sampleZeroContextFrame: frame.sampleZeroContextFrame,
                    capturedFrames: frame.publishedFrames,
                    sampleRate: frame.sampleRate,
                    frozenLatencySeconds:
                        current.admission.baseLatencySeconds +
                        current.admission.outputLatencySeconds +
                        current.admission.trackCompensationSeconds,
                    tempo: TEMPO,
                });
                return frontier > 9 + CAPTURE_FRONTIER_BOUND_BEATS && frontier < 11;
            },
            { timeout: 5_000 }
        )
        .toBe(true);
}

function capturedThirdPassFrontier(
    witness: PunchRecordingClockWitness,
    publishedGestureBeat: number,
    pcmFrames: number
): number {
    const stop = stopClockEvent(witness);
    const frame = stop.recording!;
    const capturedFrames = finalCapturedFrames(witness);
    expect(frame.sampleRate).toBe(MIC_SAMPLE_RATE);
    expect(pcmFrames, 'the decoded buffer must own every worklet-published frame').toBe(capturedFrames);
    expect(witness.firstFrame?.recording?.sampleZeroContextFrame).toBe(frame.sampleZeroContextFrame);
    expect(witness.samples.length).toBeGreaterThan(20);
    for (const sample of witness.samples) {
        const drift = sample.recording && captureFrameDrift(sample.recording);
        expect(drift, 'every sampled input quantum must track the recording context').not.toBeNull();
        expect(Math.abs(drift!)).toBeLessThanOrEqual(RECORDING_RENDER_QUANTUM_FRAMES);
    }
    expect(Math.abs(captureFrameDrift(frame)!)).toBeLessThanOrEqual(RECORDING_RENDER_QUANTUM_FRAMES);
    const worker = witness.events.find((event) => event.kind === 'worker-wav');
    expect(worker?.wavBytes).toBe(44 + capturedFrames * Float32Array.BYTES_PER_ELEMENT);
    expect(worker?.sampleZeroContextFrame).toBe(frame.sampleZeroContextFrame);
    expect(worker?.sampleRate).toBe(MIC_SAMPLE_RATE);
    return compensatedCaptureFrontierBeat({
        gestureBeat: publishedGestureBeat,
        gestureContextFrame: frame.contextFrame,
        sampleZeroContextFrame: frame.sampleZeroContextFrame!,
        capturedFrames,
        sampleRate: frame.sampleRate,
        frozenLatencySeconds: frozenRecordingLatency(witness),
        tempo: TEMPO,
    });
}

function assertIndependentClockReferenceControls(): void {
    const sampleZeroContextFrame = 240_000;
    const capturedFrames = MIC_SAMPLE_RATE * 4;
    const gestureContextFrame = sampleZeroContextFrame + capturedFrames;
    const gestureBeat = 10.4;
    for (const latency of [0.02, 0.17]) {
        const frontier = compensatedCaptureFrontierBeat({
            gestureBeat,
            gestureContextFrame,
            sampleZeroContextFrame,
            capturedFrames,
            sampleRate: MIC_SAMPLE_RATE,
            frozenLatencySeconds: latency,
            tempo: TEMPO,
        });
        expect(frontier).toBeCloseTo(gestureBeat - (latency * TEMPO) / 60, 10);
    }
    const ignoredCompensation = compensatedCaptureFrontierBeat({
        gestureBeat,
        gestureContextFrame,
        sampleZeroContextFrame,
        capturedFrames,
        sampleRate: MIC_SAMPLE_RATE,
        frozenLatencySeconds: 0,
        tempo: TEMPO,
    });
    expect(Math.abs(ignoredCompensation - (gestureBeat - (0.17 * TEMPO) / 60))).toBeGreaterThan(
        CAPTURE_FRONTIER_BOUND_BEATS
    );
    const missingFrames = 1024;
    expect(
        captureFrameDrift({
            contextFrame: gestureContextFrame,
            sampleZeroContextFrame,
            publishedFrames: capturedFrames - missingFrames,
            sampleRate: MIC_SAMPLE_RATE,
        })
    ).toBeGreaterThan(RECORDING_RENDER_QUANTUM_FRAMES);
}

test('keeps real punch-loop PCM through comp, undo, export and reopen', async ({
    browserName: _browserName,
}, testInfo: TestInfo) => {
    assertIndependentClockReferenceControls();
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== 'string') {
        throw new TypeError('Punch acceptance needs a private Playwright baseURL');
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
        await installPunchRecordingClockWitness(page);
        observeConsole(page, 'initial');
        await installBrowserPlaybackObserver(page);
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Untitled Project' }).click();
        await page.locator('input:focus').fill(PROJECT_NAME);
        await page.locator('input:focus').press('Enter');

        const trackId = await configurePunchTrack(page);
        await bindPunchRecordingClockWitness(page, trackId);

        await recordThroughTwoWraps(page, trackId);
        await waitForCapturedThirdPassFrontier(page);
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
        const committedOwners = await recordingOwners(page, trackId);
        expect(committedOwners.raw).toEqual(committedOwners.projected);
        expect(committedOwners.raw.clips).toHaveLength(1);
        expect(committedOwners.raw.lanes).toHaveLength(1);
        const originalPcm = await pcmFingerprint(page, captured.bufferId);
        expect(originalPcm.sampleRate).toBe(MIC_SAMPLE_RATE);
        const captureWitness = await readPunchRecordingClockWitness(page);
        const stop = stopClockEvent(captureWitness);
        expect(stop.output?.wrapCount).toBe(2);
        const expectedEndBeat = capturedThirdPassFrontier(captureWitness, stop.output!.gestureBeat, originalPcm.frames);
        expect(passes[2].endBeat).toBeGreaterThanOrEqual(expectedEndBeat - CAPTURE_FRONTIER_BOUND_BEATS);
        expect(passes[2].endBeat).toBeLessThanOrEqual(expectedEndBeat + CAPTURE_FRONTIER_BOUND_BEATS);
        expect(passes[2].passSourceEndSeconds).toBeCloseTo(captured.durationSeconds, 6);
        const envelope = await recordedEnvelope(page, captured.bufferId);
        expect(envelope.length).toBeGreaterThan(30);
        expect(Math.max(...envelope)).toBeGreaterThan(0.02);
        expect(
            bestMicTimecodeMatch(envelope),
            'committed PCM must match the timecoded WAV fed to Chromium getUserMedia'
        ).toBeGreaterThan(0.45);

        await page.getByTestId('transport-undo').click();
        await expect.poll(async () => (await recordingSnapshot(page, trackId))?.takes.length ?? 0).toBe(0);
        const undoneOwners = await recordingOwners(page, trackId);
        expect(undoneOwners.raw).toEqual(undoneOwners.projected);
        expect(undoneOwners.raw).toEqual({ clips: [], lanes: [] });
        await page.getByTestId('transport-redo').click();
        await expect.poll(async () => (await recordingSnapshot(page, trackId))?.takes.length ?? 0).toBe(3);
        const restored = await recordingSnapshot(page, trackId);
        expect(restored?.clipId).toBe(captured.clipId);
        expect(restored?.bufferId).toBe(captured.bufferId);
        expect(restored?.takes).toEqual(captured.takes);
        expect(await recordingOwners(page, trackId)).toEqual(committedOwners);

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
        ].map((region) => {
            const start = Math.max(region.start, region.take.startBeat + 0.1);
            return {
                ...region,
                start,
                end: Math.min(start + region.end - region.start, region.take.endBeat - 0.1),
            };
        });
        expect(new Set(compPlan.map((region) => region.take.id)).size).toBe(3);
        for (const region of compPlan) {
            expect(
                region.end - region.start,
                'each comp must retain room for interior export PCM probes'
            ).toBeGreaterThan(0.3);
        }
        await page.evaluate(() => {
            const events: { type: string; phase: string; stripTarget: boolean; rowDraggable: boolean }[] = [];
            Reflect.set(window, '__punchCompGestureEvents', events);
            for (const type of ['mousedown', 'mousemove', 'mouseup', 'dragstart', 'drag', 'dragend', 'drop']) {
                for (const capture of [true, false]) {
                    document.addEventListener(
                        type,
                        (event) => {
                            if (events.length >= 200) {
                                return;
                            }
                            const target = event.target instanceof Element ? event.target : null;
                            const row = target?.closest('[role="row"]');
                            if (!row) {
                                return;
                            }
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

        // Disarm through the real track control before Play can auto-record another punch.
        const originalTakeIds = captured.takes.map((take) => take.id);
        const armButton = page.getByTestId(`track-arm-${trackId}`);
        await armButton.click();
        await expect(armButton).toHaveAttribute('aria-label', 'Arm Punch mic');
        await expectNoAuditionRecording(page, trackId, originalTakeIds);

        await prepareRecordedBufferObserver(page, captured.bufferId);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        await expectNoAuditionRecording(page, trackId, originalTakeIds);
        const positions = await selectedSourcePositions(page, trackId);
        const expectedOffsets = positions
            .filter((position) => compPlan.some((region) => Math.abs(region.start - position.startBeat) < 0.1))
            .map((position) => position.sourceSeconds);
        expect(expectedOffsets).toHaveLength(3);
        await expect
            .poll(
                async () => {
                    const starts = (await browserStarts(page)).filter((entry) => entry.recordedBuffer);
                    return expectedOffsets.filter((offset) =>
                        starts.some((entry) => Math.abs(entry.offsetSeconds - offset) < 0.35)
                    ).length;
                },
                { timeout: 8_000 }
            )
            .toBe(3);
        await page.getByTestId('transport-stop').click();
        await expectNoAuditionRecording(page, trackId, originalTakeIds);
        const starts = await browserStarts(page);
        expect(starts.some((entry) => entry.recordedBuffer && (entry.durationSeconds ?? 0) > 0)).toBe(true);
        expectFiniteSourceStarts(starts, positions, comped.regions, passes);
        const normalExportScore = await compareExportWithSelectedPhrase(page, trackId, captured.bufferId, 1);

        await page.evaluate(async (clipId) => {
            const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
            await executeAppAction({ type: 'setClipStretchMode', payload: { clipId, mode: 'repitch' } });
            await executeAppAction({ type: 'setClipStretchRatio', payload: { clipId, ratio: 1.1 } });
        }, captured.clipId);
        await prepareRecordedBufferObserver(page, captured.bufferId);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        await expectNoAuditionRecording(page, trackId, originalTakeIds);
        await expect
            .poll(async () => (await browserStarts(page)).filter((entry) => entry.recordedBuffer).length, {
                timeout: 8_000,
            })
            .toBeGreaterThanOrEqual(3);
        await page.getByTestId('transport-stop').click();
        await expectNoAuditionRecording(page, trackId, originalTakeIds);
        expectFiniteSourceStarts(
            await browserStarts(page),
            await selectedSourcePositions(page, trackId),
            comped.regions,
            passes
        );
        const stretchExportScore = await compareExportWithSelectedPhrase(page, trackId, captured.bufferId, 1.1);

        await expectNoAuditionRecording(page, trackId, originalTakeIds);
        const savedOwners = await recordingOwners(page, trackId);
        expect(savedOwners.raw).toEqual(savedOwners.projected);

        const projectId = await page.evaluate(async () => {
            const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
            return projectStore.value?.projectId;
        });
        if (!projectId) {
            throw new Error('The captured project has no identity before Save');
        }
        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(page.getByTitle('Unsaved changes')).toHaveCount(0, { timeout: 30_000 });
        await page.close();

        const reopened = await context.newPage();
        activePage = reopened;
        observeConsole(reopened, 'reopened');
        await installBrowserPlaybackObserver(reopened);
        const bootTimeline = attach_first_paint_console(reopened);
        await reopened.goto('/');
        await wait_for_console_marker(bootTimeline, CAPABILITIES_MARKER, 30_000);
        await expect
            .poll(() => settledReopenMode(reopened, projectId), { timeout: 30_000 })
            .toMatch(/^(saved-active|launch-ready)$/);
        if ((await settledReopenMode(reopened, projectId)) === 'launch-ready') {
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
        expect(persisted?.takes).toEqual(comped.takes);
        expect(await recordingOwners(reopened, trackId)).toEqual(savedOwners);
        expect(await pcmFingerprint(reopened, captured.bufferId)).toEqual(originalPcm);
        await expect(reopened.getByTestId(`track-arm-${trackId}`)).toHaveAttribute('aria-label', 'Arm Punch mic');
        await prepareRecordedBufferObserver(reopened, captured.bufferId);
        await seek(reopened, LOOP_START);
        await reopened.getByTestId('transport-play').click();
        await expectNoAuditionRecording(reopened, trackId, originalTakeIds);
        await expect
            .poll(async () => (await browserStarts(reopened)).filter((entry) => entry.recordedBuffer).length, {
                timeout: 8_000,
            })
            .toBeGreaterThanOrEqual(3);
        await reopened.getByTestId('transport-stop').click();
        await expectNoAuditionRecording(reopened, trackId, originalTakeIds);
        expectFiniteSourceStarts(
            await browserStarts(reopened),
            await selectedSourcePositions(reopened, trackId),
            comped.regions,
            passes
        );
        const reopenedExportScore = await compareExportWithSelectedPhrase(reopened, trackId, captured.bufferId, 1.1);
        await testInfo.attach('punch-loop-acceptance-evidence', {
            body: JSON.stringify(
                {
                    projectId,
                    originalPcm,
                    clockWitness: captureWitness,
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
        if (!completed && activePage) {
            await retainPunchFailureDiagnostics(activePage, testInfo, 'punch-failure-state');
            if (!activePage.isClosed()) {
                await activePage
                    .screenshot({ path: testInfo.outputPath('failure.png'), fullPage: true })
                    .catch(() => undefined);
            }
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

test('keeps a live take when Pause is immediately followed by New Project', async ({
    browserName: _browserName,
}, testInfo: TestInfo) => {
    test.setTimeout(180_000);
    const projectName = 'Punch immediate Pause replacement';
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== 'string') {
        throw new TypeError('Punch acceptance needs a private Playwright baseURL');
    }
    const micWav = testInfo.outputPath('pause-timecoded-microphone.wav');
    await writeFile(micWav, fakeMicrophoneWav());
    const browser = await chromium.launch({
        channel: 'chromium',
        headless: true,
        args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micWav}`],
    });
    const context = await browser.newContext({
        baseURL,
        permissions: ['microphone'],
        serviceWorkers: 'block',
        viewport: { width: 1440, height: 900 },
    });
    context.setDefaultTimeout(30_000);
    let activePage = await context.newPage();
    let completed = false;
    const consoleMessages: string[] = [];
    const observe = (page: Page): void => {
        page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
        page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error.stack ?? error.message}`));
    };
    try {
        const page = activePage;
        await installPunchRecordingClockWitness(page);
        observe(page);
        await setupWorkspace(page);
        await launch_new_project(page);
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await page.getByTestId('project-name').click();
        await page.locator('input:focus').fill(projectName);
        await page.locator('input:focus').press('Enter');
        const projectId = await page.evaluate(async () => {
            const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
            const id = projectStore.value?.projectId;
            if (!id) {
                throw new Error('The outgoing microphone project has no identity');
            }
            return id;
        });
        const trackId = await configurePunchTrack(page);
        await bindPunchRecordingClockWitness(page, trackId);
        await observeClosingRecording(page, trackId, projectId);
        await recordThroughTwoWraps(page, trackId);

        // Intentionally no recorder, commit, dirty-dot or Save wait between these product gestures.
        await page.getByTestId('transport-play').click();
        await page.getByRole('button', { name: 'Project menu', exact: true }).click();
        await page.getByTestId('menu-new-project').click();
        const replacementInstalled = async (): Promise<boolean> => {
            const id = await readyProjectId(page);
            return id !== null && id !== projectId;
        };
        await expect.poll(replacementInstalled).toBe(true);
        await expect(page.getByTestId('project-name')).toHaveText('Untitled Project');
        await expect.poll(() => page.evaluate(() => Boolean(Reflect.get(window, '__punchClosing')))).toBe(true);
        const closing: RecordingSnapshot = await page.evaluate(() => Reflect.get(window, '__punchClosing'));
        const pause: { projectId: string; beat: number; sessionStatus: string | null; takeIds: string[] } =
            await page.evaluate(() => Reflect.get(window, '__punchPause'));
        const request: { projectId: string; idle: boolean } = await page.evaluate(() =>
            Reflect.get(window, '__punchReplacementRequest')
        );
        expect(pause, 'the outgoing transport must publish its Pause position').toBeTruthy();
        expect(request, 'the real New Project click must be observed').toBeTruthy();
        expect(pause.projectId).toBe(projectId);
        const pauseRequest: { projectId: string; recording: boolean; sessionStatus: string | null } =
            await page.evaluate(() => Reflect.get(window, '__punchPauseRequest'));
        expect(pauseRequest, 'the real Pause click must be observed').toBeTruthy();
        expect(pauseRequest.projectId).toBe(projectId);
        expect(pauseRequest.recording).toBe(true);
        expect(pauseRequest.sessionStatus, 'Pause must reach an actively capturing microphone').toBe('recording');
        expect(request.projectId, 'New Project must replace the same outgoing owner').toBe(projectId);
        expect(closing.takes.map((take) => take.id)).toEqual(pause.takeIds);
        expect(closing.takes).toHaveLength(3);
        const passes = [...closing.takes].sort((a, b) => a.passDepthSeconds! - b.passDepthSeconds!);
        expect(
            passes.every(
                (take) =>
                    Number.isFinite(take.passDepthSeconds) &&
                    Number.isFinite(take.passSourceEndSeconds) &&
                    take.passSourceEndSeconds! > take.passDepthSeconds!
            )
        ).toBe(true);
        expect(passes[0].startBeat).toBeCloseTo(PUNCH_IN, 0);
        expect(passes[0].endBeat).toBeCloseTo(LOOP_END, 0);
        expect(passes[1].startBeat).toBeCloseTo(LOOP_START, 0);
        expect(passes[1].endBeat).toBeCloseTo(LOOP_END, 0);
        expect(passes[2].startBeat).toBeCloseTo(LOOP_START, 0);
        expect(passes.every((take) => take.passSourceEndSeconds! <= closing.durationSeconds + 0.1)).toBe(true);
        const originalPcm = await pcmFingerprint(page, null);
        const captureWitness = await readPunchRecordingClockWitness(page);
        const pauseClick = captureWitness.events.find((event) => event.kind === 'capture-pause-click');
        expect(pauseClick?.output?.wrapCount).toBe(2);
        expect(pauseClick?.output?.isRecording).toBe(true);
        const stop = stopClockEvent(captureWitness);
        expect(stop.output!.gestureBeat).toBeGreaterThanOrEqual(pause.beat - CAPTURE_FRONTIER_BOUND_BEATS);
        expect(stop.output!.gestureBeat).toBeLessThanOrEqual(pause.beat + CAPTURE_FRONTIER_BOUND_BEATS);
        const expectedEndBeat = capturedThirdPassFrontier(captureWitness, pause.beat, originalPcm.frames);
        expect(passes[2].endBeat).toBeGreaterThanOrEqual(expectedEndBeat - CAPTURE_FRONTIER_BOUND_BEATS);
        expect(passes[2].endBeat).toBeLessThanOrEqual(expectedEndBeat + CAPTURE_FRONTIER_BOUND_BEATS);
        expect(passes[2].passSourceEndSeconds).toBeCloseTo(closing.durationSeconds, 6);
        const envelope = await recordedEnvelope(page, null);
        expect(originalPcm.sampleRate).toBe(MIC_SAMPLE_RATE);
        expect(originalPcm.frames).toBeGreaterThan(MIC_SAMPLE_RATE * 3);
        expect(envelope.length).toBeGreaterThan(30);
        expect(Math.max(...envelope)).toBeGreaterThan(0.02);
        expect(bestMicTimecodeMatch(envelope)).toBeGreaterThan(0.45);
        await page.evaluate(() => Reflect.get(window, '__punchUnsubscribe')());
        await page.close();

        const reopened = await context.newPage();
        activePage = reopened;
        observe(reopened);
        await reopenRecentProject(reopened, projectId, projectName);
        await expect(reopened.getByTestId(`track-arm-${trackId}`)).toBeVisible();
        await expect
            .poll(async () => (await recordingSnapshot(reopened, trackId))?.durationSeconds ?? 0)
            .toBeGreaterThan(3);
        expect(await recordingSnapshot(reopened, trackId)).toEqual(closing);
        const owners = await recordingOwners(reopened, trackId);
        expect(owners.raw).toEqual(owners.projected);
        expect(owners.raw.clips).toEqual([
            {
                id: closing.clipId,
                bufferId: closing.bufferId,
                startBeat: closing.clipStartBeat,
                endBeat: closing.clipEndBeat,
            },
        ]);
        expect(owners.raw.lanes).toHaveLength(1);
        expect(owners.raw.lanes[0].takes).toEqual(closing.takes);
        expect(owners.raw.lanes[0].regions).toEqual(closing.regions);
        expect(await pcmFingerprint(reopened, closing.bufferId)).toEqual(originalPcm);
        await testInfo.attach('immediate-pause-replacement-evidence', {
            body: JSON.stringify(
                {
                    projectId,
                    trackId,
                    pauseRequest,
                    pause,
                    request,
                    closing,
                    originalPcm,
                    clockWitness: captureWitness,
                },
                null,
                2
            ),
            contentType: 'application/json',
        });
        completed = true;
    } finally {
        if (!completed) {
            await retainPunchFailureDiagnostics(activePage, testInfo, 'pause-replacement-failure-state');
        }
        if (!activePage.isClosed()) {
            await activePage
                .screenshot({ path: testInfo.outputPath('pause-replacement-final.png') })
                .catch(() => undefined);
        }
        await writeFile(testInfo.outputPath('pause-browser-console.json'), JSON.stringify(consoleMessages, null, 2));
        try {
            await context.close();
        } finally {
            await browser.close();
        }
    }
});
