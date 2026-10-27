// A browser-carrier check: Web Audio starts and exported PCM are observable here; a native device clock is not.
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { stringify } from 'superjson';

import {
    enable_direct_e2e_viewport,
    launch_new_project,
    setupWorkspace,
    wait_for_launch_first_paint,
    wait_for_workspace_ready,
} from './e2eUtils';
import { attach_first_paint_console, CAPABILITIES_MARKER, wait_for_console_marker } from './firstPaintDiagnostics';
import { interiorTempoSeconds, physicalSourceFixture } from './tempoSourcePhysicalFixtures';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const PROJECT_NAME = 'Source time frame acceptance';
const SAMPLE_RATE = 48_000;
const LAST_SOURCE_FRAME = 16_799;
const EXCLUSIVE_SOURCE_FRAME = 16_800;
const LAST_OUTPUT_FRAME = 45_599;
const EXCLUSIVE_OUTPUT_FRAME = 45_600;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const STEP_TIMEOUT = 30_000;

test.use({ actionTimeout: STEP_TIMEOUT, navigationTimeout: STEP_TIMEOUT });

type SourceClip = {
    id: string;
    trackId: string;
    type: string;
    startBeat: number;
    endBeat: number;
    audioBufferId?: string;
    audioOffsetBeats?: number;
    audioOffsetSeconds?: number;
    audioUnwrappedOffsetSeconds?: number;
    stretchMode?: string;
    stretchRatio?: number;
    hasSourceSeconds: boolean;
    loopOriginBeat?: number;
};
type TempoEvent = { id: string; beat: number; tempo: number; curve: string };
type CompRegion = { startBeat: number; endBeat: number; takeId: string; audioSource?: unknown };
type TakeLane = {
    id: string;
    trackId: string;
    takes: { id: string; clipId: string; name: string }[];
    activeCompRegions: CompRegion[];
    baseGapAudioSources?: unknown[];
};
type OwnerState = { clips: SourceClip[]; tempo: TempoEvent[]; lane: TakeLane | null };
type Mirror = {
    projectId?: string;
    witness?: string;
    past: {
        kind: string;
        action?: { type: string };
        inverseAction?: { type: string };
        redoAction?: { type: string };
    }[];
    future: { kind: string; action?: { type: string } }[];
};
type Snapshot = {
    projectId: string;
    witness: string;
    trackId: string;
    raw: OwnerState;
    projected: OwnerState;
    mirror: Mirror;
    buffer: {
        id: string;
        sampleRate: number;
        frames: number;
        body: number[];
        finalPositive: number;
        firstNegative: number;
    };
};
type WaveformObservation = {
    rectangle: { startBeat: number; endBeat: number };
    programme: { startBeat: number; endBeat: number; audioOffsetSeconds?: number }[] | null;
    occurrences: { startSample: number; endSample: number; audibleStartBeat: number; audibleTimelineBeats: number }[];
    allClipRanges: { startBeat: number; endBeat: number }[];
};
type BrowserStart = {
    offsetSeconds: number;
    durationSeconds: number | null;
    importedBuffer: boolean;
    playbackRate: number;
};

// Independent fixture and clock oracle: no production source-time projector participates in these numbers.
function sourceWav(): Buffer {
    const frames = SAMPLE_RATE;
    const wav = Buffer.alloc(44 + frames * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(SAMPLE_RATE, 24);
    wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(frames * 2, 40);
    for (let frame = 0; frame < frames; frame += 1) {
        let sample = 16_384;
        if (frame < 4_800) {
            sample = 4_096;
        } else if (frame < 10_800) {
            sample = 8_192;
        }
        if (frame === LAST_SOURCE_FRAME) {
            sample = 24_576;
        }
        if (frame >= EXCLUSIVE_SOURCE_FRAME) {
            sample = -24_576;
        }
        wav.writeInt16LE(sample, 44 + frame * 2);
    }
    return wav;
}

function songSeconds(beat: number, thirdEvent = true): number {
    if (beat <= 0.25) {
        return beat * 0.5;
    }
    if (!thirdEvent || beat <= 0.45) {
        return beat / 4 + 1 / 16;
    }
    return beat / 2 - 1 / 20;
}

function expectFrame(actual: number, expected: number, label: string): void {
    expect(actual, `${label}: expected frame ${expected}, observed ${actual}`).toBe(expected);
}

function expectDecodedPcm16(actual: number, encoded: number, label: string): void {
    // Chromium's WAV decoder maps positive full scale by 32767; the fixture is authenticated within one PCM16 LSB.
    expect(Math.abs(actual - encoded / 32_768), label).toBeLessThanOrEqual(1 / 32_768);
}

function trackRow(page: Page): Locator {
    return page
        .getByRole('grid', { name: 'Track list', exact: true })
        .locator('[role="row"][draggable="true"]')
        .filter({ has: page.getByText('Audio', { exact: true }) });
}

async function palette(page: Page, label: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeVisible();
    await input.fill(label);
    const option = page.getByRole('option').filter({ has: page.getByText(label, { exact: true }) });
    await expect(option).toBeVisible();
    await option.click();
    await expect(input).toHaveCount(0);
}

async function installPlaybackObserver(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const nativeStart = AudioBufferSourceNode.prototype.start;
        Reflect.set(window, '__sourceTimeStarts', []);
        AudioBufferSourceNode.prototype.start = function (...args): void {
            const starts = Reflect.get(window, '__sourceTimeStarts') as BrowserStart[];
            starts.push({
                offsetSeconds: args[1] ?? 0,
                durationSeconds: args[2] ?? null,
                importedBuffer: this.buffer === Reflect.get(window, '__sourceTimeBuffer'),
                playbackRate: this.playbackRate.value,
            });
            Reflect.apply(nativeStart, this, args);
        };
        Reflect.deleteProperty(window, 'showSaveFilePicker');
    });
}

async function readSnapshot(page: Page): Promise<Snapshot> {
    const serialized = await page.evaluate(
        async ({ lastSourceFrame, exclusiveSourceFrame }) => {
            const [
                { getCrdtDoc, captureDurableDocumentWitness },
                { trackStore },
                { takeLaneStore },
                { tempoMapStore },
                { projectStore },
                { audioBufferCache },
            ] = await Promise.all([
                import('/src/modules/CrdtDocument/useCases/index.ts'),
                import('/src/modules/Arrangement/stores/trackStore.ts'),
                import('/src/modules/Arrangement/stores/takeLaneStore.ts'),
                import('/src/modules/Transport/stores/tempoMapStore.ts'),
                import('/src/modules/Project/stores/projectStore.ts'),
                import('/src/modules/AudioEngine/stores/audioBufferCache.ts'),
            ]);
            const document = getCrdtDoc('root');
            const project = projectStore.value;
            const track = trackStore.value?.tracks.find((entry) => entry.name === 'Audio');
            const rawTrack = document?.tracks?.tracks.find((entry) => entry.id === track?.id);
            if (!document || !project?.initialized || project.loading || !project.projectId || !track || !rawTrack) {
                throw new Error('The actual audio project has not hydrated');
            }
            const witness = captureDurableDocumentWitness();
            const clips = (entries: typeof track.clips): SourceClip[] =>
                entries.map((clip) => ({
                    id: clip.id,
                    trackId: clip.trackId,
                    type: clip.type,
                    startBeat: clip.startBeat,
                    endBeat: clip.endBeat,
                    audioBufferId: clip.audioBufferId,
                    audioOffsetBeats: clip.audioOffsetBeats,
                    audioOffsetSeconds: clip.audioOffsetSeconds,
                    audioUnwrappedOffsetSeconds: clip.audioUnwrappedOffsetSeconds,
                    stretchMode: clip.stretchMode,
                    stretchRatio: clip.stretchRatio,
                    hasSourceSeconds: Object.hasOwn(clip, 'audioOffsetSeconds'),
                    loopOriginBeat: clip.loopOriginBeat,
                }));
            const audioClip = track.clips.find((clip) => clip.type === 'audio' && clip.audioBufferId);
            if (!audioClip?.audioBufferId) {
                throw new Error('Imported audio clip is absent');
            }
            const buffer = audioBufferCache.get(audioClip.audioBufferId);
            if (!buffer) {
                throw new Error('Imported PCM is absent from the real audio cache');
            }
            const samples = buffer.getChannelData(0);
            const mirrorText = sessionStorage.getItem('sourdaw-undo-session');
            if (!mirrorText) {
                throw new Error('The real command mirror is absent');
            }
            const owner = (clipEntries: typeof track.clips, lane: unknown, tempo: unknown): OwnerState => ({
                clips: clips(clipEntries),
                lane: lane as TakeLane | null,
                tempo: tempo as TempoEvent[],
            });
            const raw = owner(
                rawTrack.clips,
                document.takeLanes?.lanes.find((entry) => entry.trackId === track.id) ?? null,
                document.tempoMap?.changes ?? []
            );
            const projected = owner(
                track.clips,
                takeLaneStore.value?.lanes.find((entry) => entry.trackId === track.id) ?? null,
                tempoMapStore.value?.changes ?? []
            );
            if (captureDurableDocumentWitness() !== witness) {
                throw new Error('Project changed during evidence capture');
            }
            return JSON.stringify({
                projectId: project.projectId,
                witness,
                trackId: track.id,
                raw,
                projected,
                mirror: JSON.parse(mirrorText),
                buffer: {
                    id: audioClip.audioBufferId,
                    sampleRate: buffer.sampleRate,
                    frames: buffer.length,
                    body: [samples[6_000], samples[12_000]],
                    finalPositive: samples[lastSourceFrame],
                    firstNegative: samples[exclusiveSourceFrame],
                },
            });
        },
        { lastSourceFrame: LAST_SOURCE_FRAME, exclusiveSourceFrame: EXCLUSIVE_SOURCE_FRAME }
    );
    return JSON.parse(serialized);
}

function onlyClip(snapshot: Snapshot): SourceClip {
    expect(snapshot.raw).toEqual(snapshot.projected);
    expect(snapshot.raw.clips).toHaveLength(1);
    const clip = snapshot.raw.clips[0];
    if (!clip) {
        throw new Error('The one imported audio clip is absent');
    }
    return clip;
}

function sourceEntrySeconds(clip: SourceClip): number {
    // The clip starts under 120 BPM on every assertion leg. An absent seconds key is the supported legacy beat reading.
    return clip.audioOffsetSeconds ?? (clip.audioOffsetBeats ?? 0) * 0.5;
}

function expectSourceWindow(snapshot: Snapshot, startBeat: number, endBeat: number, sourceEntry: number): void {
    const clip = onlyClip(snapshot);
    expect(clip.startBeat).toBeCloseTo(startBeat, 5);
    expect(clip.endBeat).toBeCloseTo(endBeat, 5);
    expect(sourceEntrySeconds(clip)).toBeCloseTo(sourceEntry, 8);
    const exclusive = sourceEntry + songSeconds(endBeat) - songSeconds(startBeat);
    expectFrame(Math.round(exclusive * SAMPLE_RATE), EXCLUSIVE_SOURCE_FRAME, 'clip exclusive source end');
}

async function waveform(page: Page, trackId: string, clipId: string): Promise<WaveformObservation> {
    return page.evaluate(
        async ({ owner, target }) => {
            const [{ buildTimelineRenderModel }, { getAudioWaveformOccurrences }, { audioBufferCache }] =
                await Promise.all([
                    import('/src/modules/Arrangement/useCases/buildTimelineRenderModel.ts'),
                    import('/src/modules/Arrangement/presentations/renderers/audioWaveformSpan.ts'),
                    import('/src/modules/AudioEngine/stores/audioBufferCache.ts'),
                ]);
            // TimelineSurface renders this builder's model; read the same clip and waveform function as Canvas/WebGPU.
            const model = buildTimelineRenderModel();
            const track = model.tracks.find((entry) => entry.id === owner);
            const clip = track?.clips.find((entry) => entry.id === target);
            if (!track || !clip?.audioBufferId) {
                throw new Error('Rendered audio clip is absent');
            }
            const buffer = audioBufferCache.get(clip.audioBufferId);
            if (!buffer) {
                throw new Error('Rendered audio buffer is absent');
            }
            const occurrences = getAudioWaveformOccurrences({
                clip,
                model,
                sampleRate: buffer.sampleRate,
                bufferLength: buffer.length,
                maxBins: 600,
            });
            return {
                rectangle: { startBeat: clip.startBeat, endBeat: clip.endBeat },
                programme:
                    clip.audioProgramme?.map((part) => ({
                        startBeat: part.startBeat,
                        endBeat: part.endBeat,
                        audioOffsetSeconds: part.audioOffsetSeconds,
                    })) ?? null,
                occurrences: occurrences.map(({ span }) => ({
                    startSample: span.startSample,
                    endSample: span.endSample,
                    audibleStartBeat: span.audibleStartBeat,
                    audibleTimelineBeats: span.audibleTimelineBeats,
                })),
                allClipRanges: track.clips.map((entry) => ({ startBeat: entry.startBeat, endBeat: entry.endBeat })),
            };
        },
        { owner: trackId, target: clipId }
    );
}

async function canvasPoint(
    page: Page,
    clip: SourceClip,
    beat: number
): Promise<{ x: number; y: number; pixelsPerBeat: number }> {
    const header = await trackRow(page).getByRole('button', { name: 'Mute Audio', exact: true }).boundingBox();
    const canvas = await page.getByLabel('Timeline editor surface').boundingBox();
    const view = await page.evaluate(async () => {
        const { timelineViewStore } = await import('/src/modules/Arrangement/stores/timelineViewStore.ts');
        return timelineViewStore.value;
    });
    if (!header || !canvas || !view) {
        throw new Error('Visible timeline geometry is unavailable');
    }
    const x = canvas.x + beat * view.pixelsPerBeat - view.scrollX;
    const y = header.y + header.height / 2;
    expect(x).toBeGreaterThan(canvas.x + 2);
    expect(x).toBeLessThan(canvas.x + canvas.width - 2);
    expect(y).toBeGreaterThan(canvas.y);
    expect(y).toBeLessThan(canvas.y + canvas.height);
    expect(beat).toBeGreaterThanOrEqual(clip.startBeat);
    expect(beat).toBeLessThanOrEqual(clip.endBeat);
    return { x, y, pixelsPerBeat: view.pixelsPerBeat };
}

async function dragEdge(page: Page, clip: SourceClip, side: 'left' | 'right', destinationBeat: number): Promise<void> {
    // Read geometry inside the rectangle, then reach the real edge. Beat0's
    // edge is at the canvas boundary; the pointer itself stays two pixels inside.
    const anchor =
        side === 'left' ? Math.min(clip.startBeat + 0.125, (clip.startBeat + clip.endBeat) / 2) : clip.endBeat;
    const edge = await canvasPoint(page, clip, anchor);
    const edgeBeat = side === 'left' ? clip.startBeat : clip.endBeat;
    const edgeX = edge.x + (edgeBeat - anchor) * edge.pixelsPerBeat;
    const from = edgeX + (side === 'left' ? 2 : -2);
    const to = edgeX + (destinationBeat - edgeBeat) * edge.pixelsPerBeat;
    await page.mouse.move(from, edge.y);
    await page.mouse.down();
    await page.mouse.move(to, edge.y, { steps: 8 });
    await page.mouse.up();
}

async function addTempoEvent(page: Page, beat: number, bpm: number, before: Snapshot): Promise<Snapshot> {
    const dialog = page.getByRole('dialog', { name: 'Tempo map editor' });
    await dialog.getByRole('spinbutton', { name: 'New tempo change beat' }).fill(String(beat));
    await dialog.getByRole('spinbutton', { name: 'New tempo change BPM' }).fill(String(bpm));
    await dialog.getByRole('combobox', { name: 'New tempo change curve type' }).selectOption('instant');
    await dialog.getByRole('button', { name: 'Add tempo change' }).click();
    await expect.poll(async () => (await readSnapshot(page)).raw.tempo.length).toBe(before.raw.tempo.length + 1);
    const after = await readSnapshot(page);
    expect(after.raw).toEqual(after.projected);
    expect(after.raw.tempo.map((event) => [event.beat, event.tempo, event.curve])).toEqual([
        ...before.raw.tempo.map((event) => [event.beat, event.tempo, event.curve]),
        [beat, bpm, 'instant'],
    ]);
    await expect
        .poll(async () => (await readSnapshot(page)).mirror.past.length, {
            message: 'each visible tempo add must enter command history once',
        })
        .toBe(before.mirror.past.length + 1);
    const committed = await readSnapshot(page);
    const entry = committed.mirror.past.at(-1);
    expect(entry?.kind).toBe('action');
    expect(entry?.inverseAction?.type).toBeTruthy();
    expect(entry?.redoAction?.type).toBeTruthy();
    return committed;
}

async function createComp(page: Page, snapshot: Snapshot): Promise<Snapshot> {
    await trackRow(page).getByRole('button', { name: 'Toggle variation lanes' }).click();
    await page.getByRole('button', { name: 'Add take', exact: true }).click();
    const promote = page.getByRole('button', { name: 'Promote Take 1 to main take', exact: true });
    await expect(promote).toBeVisible();
    const separator = page.locator('[data-onboarding="track-list"] + [role="separator"][aria-orientation="vertical"]');
    const separatorBox = await separator.boundingBox();
    if (!separatorBox) {
        throw new Error('Take lane resize handle is absent');
    }
    await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(separatorBox.x + separatorBox.width / 2 + 180, separatorBox.y + 100, { steps: 8 });
    await page.mouse.up();
    const strip = promote.locator('..').locator('[role="presentation"]');
    await expect.poll(async () => (await strip.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    const box = await strip.boundingBox();
    if (!box) {
        throw new Error('Take comp strip is absent');
    }
    const minBeat = Math.max(0, onlyClip(snapshot).startBeat);
    const maxBeat = Math.max(onlyClip(snapshot).endBeat, minBeat + 4);
    const x = (beat: number) => box.x + ((beat - minBeat) / (maxBeat - minBeat)) * box.width;
    const y = box.y + box.height / 2;
    await page.mouse.move(x(1.74), y);
    await page.mouse.down();
    await page.mouse.move(x(2.25), y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await readSnapshot(page)).raw.lane?.activeCompRegions.length ?? 0).toBe(1);
    const after = await readSnapshot(page);
    expect(after.raw).toEqual(after.projected);
    const lane = after.raw.lane;
    expect(lane?.takes).toHaveLength(1);
    expect(lane?.takes[0]?.clipId).toBe(onlyClip(snapshot).id);
    expect(lane?.activeCompRegions[0]?.takeId).toBe(lane?.takes[0]?.id);
    expect(lane?.activeCompRegions[0]?.startBeat).toBeGreaterThan(1.72);
    expect(lane?.activeCompRegions[0]?.startBeat).toBeLessThan(1.78);
    expect(lane?.activeCompRegions[0]?.endBeat).toBeGreaterThan(2);
    return after;
}

async function observeStarts(
    page: Page,
    bufferId: string,
    fromBeat: number,
    windows: [number, number][],
    playbackRate = 1
): Promise<void> {
    await page.evaluate(async (id) => {
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/audioBufferCache.ts');
        const buffer = audioBufferCache.get(id);
        if (!buffer || buffer.sampleRate !== 48_000) {
            throw new Error('Playback source is not the authenticated 48 kHz PCM');
        }
        Reflect.set(window, '__sourceTimeBuffer', buffer);
        Reflect.set(window, '__sourceTimeStarts', []);
    }, bufferId);
    await page.evaluate(async (beat) => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        await executeAppAction({ type: 'seekPlayhead', payload: { beat } }, { skipUndo: true });
    }, fromBeat);
    await page.getByTestId('transport-play').click();
    try {
        await expect
            .poll(
                async () =>
                    page.evaluate(
                        () =>
                            (Reflect.get(window, '__sourceTimeStarts') as BrowserStart[]).filter(
                                (entry) => entry.importedBuffer
                            ).length
                    ),
                { timeout: 8_000 }
            )
            .toBeGreaterThanOrEqual(windows.length);
    } finally {
        await page.getByTestId('transport-stop').click();
    }
    const starts = await page.evaluate(() => Reflect.get(window, '__sourceTimeStarts') as BrowserStart[]);
    for (const [offset, duration] of windows) {
        const matching = starts.find(
            (entry) =>
                entry.importedBuffer &&
                entry.playbackRate === playbackRate &&
                entry.durationSeconds !== null &&
                Math.abs(entry.offsetSeconds - offset) * SAMPLE_RATE <= 1 &&
                Math.abs(entry.durationSeconds - duration) * SAMPLE_RATE <= 1
        );
        expect(
            matching,
            `real AudioBufferSource start must read source [${offset}, ${offset + duration})`
        ).toBeDefined();
    }
}

function pcm24Wav(bytes: Buffer): { frames: number; at: (frame: number, channel: number) => number } {
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    let format: { encoding: number; channels: number; sampleRate: number; bits: number } | null = null;
    let data: { offset: number; size: number } | null = null;
    for (let cursor = 12; cursor + 8 <= bytes.length;) {
        const size = bytes.readUInt32LE(cursor + 4);
        const offset = cursor + 8;
        expect(offset + size).toBeLessThanOrEqual(bytes.length);
        const chunk = bytes.toString('ascii', cursor, cursor + 4);
        if (chunk === 'fmt ') {
            format = {
                encoding: bytes.readUInt16LE(offset),
                channels: bytes.readUInt16LE(offset + 2),
                sampleRate: bytes.readUInt32LE(offset + 4),
                bits: bytes.readUInt16LE(offset + 14),
            };
        }
        if (chunk === 'data') {
            data = { offset, size };
        }
        cursor = offset + size + (size % 2);
    }
    expect(format).toEqual({ encoding: 1, channels: 2, sampleRate: SAMPLE_RATE, bits: 24 });
    if (!data) {
        throw new Error('Exported WAV has no PCM data chunk');
    }
    expect(data.size % 6).toBe(0);
    const frames = data.size / 6;
    return {
        frames,
        at: (frame, channel) => {
            if (frame >= frames) {
                throw new Error(`WAV frame ${frame} is beyond its data chunk`);
            }
            const unsigned = bytes.readUIntLE(data.offset + frame * 6 + channel * 3, 3);
            return unsigned >= 0x80_0000 ? unsigned - 0x100_0000 : unsigned;
        },
    };
}

async function exportPcm(page: Page): Promise<ReturnType<typeof pcm24Wav>> {
    await page.keyboard.press(`${MOD}+Shift+E`);
    const bakery = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(bakery).toBeVisible();
    await bakery.getByRole('button', { name: '48.0k', exact: true }).click();
    await bakery.getByRole('button', { name: '24-bit', exact: true }).click();
    await bakery.getByRole('button', { name: 'As mixed', exact: true }).click();
    await bakery.getByRole('button', { name: 'Off', exact: true }).click();
    await expect(bakery.getByRole('radio', { name: 'Whole project' })).toBeChecked();
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await bakery.getByRole('button', { name: 'Start Baking' }).click();
    const result = await download;
    expect(await result.failure()).toBeNull();
    const path = await result.path();
    if (!path) {
        throw new Error('The visible Bakery produced no downloadable WAV');
    }
    const pcm = pcm24Wav(await readFile(path));
    await bakery.getByRole('button', { name: 'Close Bakery' }).click();
    return pcm;
}

function expectExportEnd(pcm: ReturnType<typeof pcm24Wav>, bodyFrame: number): void {
    expect(pcm.frames).toBeGreaterThanOrEqual(EXCLUSIVE_OUTPUT_FRAME);
    for (let channel = 0; channel < 2; channel += 1) {
        expect(pcm.at(24_000, channel), 'empty arrangement gap must export as zero').toBe(0);
        expect(pcm.at(bodyFrame, channel), 'selected body stamp must be positive').toBeGreaterThan(100_000);
        expect(
            pcm.at(LAST_OUTPUT_FRAME, channel),
            'last selected source frame must survive the end fade'
        ).toBeGreaterThan(4_096);
        expect(pcm.at(LAST_OUTPUT_FRAME, channel)).toBeLessThan(pcm.at(bodyFrame, channel));
        let firstNonzero: { frame: number; value: number } | null = null;
        for (let frame = EXCLUSIVE_OUTPUT_FRAME; frame < pcm.frames; frame += 1) {
            const value = pcm.at(frame, channel);
            if (value !== 0) {
                firstNonzero = { frame, value };
                break;
            }
        }
        expect(
            firstNonzero,
            `all trailing PCM24 samples in channel ${channel} must be zero; first excluded-source sample: ${JSON.stringify(firstNonzero)}`
        ).toBeNull();
    }
}

async function readProjectOwner(page: Page) {
    return page.evaluate(async () => {
        const [{ projectStore }, { captureDurableDocumentWitness }] = await Promise.all([
            import('/src/modules/Project/stores/projectStore.ts'),
            import('/src/modules/CrdtDocument/useCases/index.ts'),
        ]);
        const mirror = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}');
        return {
            projectId: projectStore.value?.projectId,
            witness: captureDurableDocumentWitness(),
            mirrorProjectId: mirror.projectId,
            mirrorWitness: mirror.witness,
            pastLength: mirror.past?.length,
            futureLength: mirror.future?.length,
        };
    });
}

async function reopenProject(page: Page, projectId: string): Promise<Page> {
    // The supported session mirror belongs to this tab. Reload discards app
    // globals and hydrates IndexedDB while preserving the browser's sessionStorage.
    const fresh = page;
    await enable_direct_e2e_viewport(fresh);
    await fresh.addInitScript((dismissed) => {
        localStorage.setItem('wd:onboarding-completed', '1');
        localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        localStorage.setItem('wd:first-load-hint-shown', '1');
    }, stringify(true));
    const boot = attach_first_paint_console(fresh);
    const response = await fresh.reload();
    expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    await wait_for_console_marker(boot, CAPABILITIES_MARKER, 30_000);
    const mode = async () =>
        fresh.evaluate(async (projectId) => {
            const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
            const state = projectStore.value;
            if (!state || state.loading) {
                return 'pending';
            }
            if (state.initialized) {
                return state.projectId === projectId ? 'saved-active' : 'wrong-active';
            }
            return 'launch-ready';
        }, projectId);
    await expect.poll(mode, { timeout: STEP_TIMEOUT }).toMatch(/^(saved-active|launch-ready)$/);
    if ((await mode()) === 'launch-ready') {
        await wait_for_launch_first_paint(fresh);
        const recent = fresh.getByRole('button', { name: `Open recent project ${PROJECT_NAME}` });
        await expect(recent).toBeVisible();
        await recent.click();
    }
    await wait_for_workspace_ready(fresh);
    await expect.poll(async () => (await readProjectOwner(fresh)).projectId).toBe(projectId);
    return fresh;
}

async function saveAndReopen(page: Page, info: TestInfo, expected: Snapshot): Promise<Page> {
    await palette(page, 'Save Project');
    await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0, { timeout: STEP_TIMEOUT });
    await expect
        .poll(async () => {
            const saved = await readSnapshot(page);
            return saved.mirror.witness === saved.witness;
        })
        .toBe(true);
    const fresh = await reopenProject(page, expected.projectId);
    await expect.poll(async () => (await readSnapshot(fresh)).projectId).toBe(expected.projectId);
    const reopened = await readSnapshot(fresh);
    expect(reopened.raw).toEqual(expected.raw);
    expect(reopened.projected).toEqual(expected.projected);
    expect(reopened.mirror.past.map((entry) => entry.action?.type)).toEqual(
        expected.mirror.past.map((entry) => entry.action?.type)
    );
    expect(reopened.mirror.future.map((entry) => entry.action?.type)).toEqual(
        expected.mirror.future.map((entry) => entry.action?.type)
    );
    await info.attach('reopened-source-owners', {
        body: JSON.stringify(reopened, null, 2),
        contentType: 'application/json',
    });
    return fresh;
}

async function bootOwnedSourceProject(page: Page, info: TestInfo): Promise<Page> {
    await installPlaybackObserver(page);
    await setupWorkspace(page);
    await launch_new_project(page);
    await page.getByRole('button', { name: 'Untitled Project' }).click();
    await page.locator('input:focus').fill(PROJECT_NAME);
    await page.locator('input:focus').press('Enter');
    // New-project switching deliberately clears session ownership. Establish
    // the supported boot owner before recording the Source edits under test.
    const initialOwner = await readProjectOwner(page);
    if (!initialOwner.projectId) {
        throw new Error('The new project has no canonical identity');
    }
    await palette(page, 'Save Project');
    await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0, { timeout: STEP_TIMEOUT });
    page = await reopenProject(page, initialOwner.projectId);
    await expect
        .poll(
            async () => {
                const owner = await readProjectOwner(page);
                return (
                    owner.projectId === initialOwner.projectId &&
                    owner.mirrorProjectId === owner.projectId &&
                    owner.mirrorWitness === owner.witness &&
                    owner.pastLength === 0 &&
                    owner.futureLength === 0
                );
            },
            { message: 'Source edits require the actual booted project and session owner' }
        )
        .toBe(true);
    await info.attach('initial-boot-project-owner', {
        body: JSON.stringify(await readProjectOwner(page), null, 2),
        contentType: 'application/json',
    });
    return page;
}

async function importSourceFixture(page: Page, wav: Buffer, filename: string): Promise<Snapshot> {
    await palette(page, 'Add Audio Track');
    await expect(trackRow(page)).toBeVisible();
    await trackRow(page).click({ button: 'right', position: { x: 8, y: 8 } });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (await chooser).setFiles({ name: filename, mimeType: 'audio/wav', buffer: wav });
    await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(1);
    return readSnapshot(page);
}

async function authenticateSamples(page: Page, bufferId: string, samples: [number, number][]): Promise<void> {
    const actual = await page.evaluate(
        async ({ id, frames }) => {
            const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/audioBufferCache.ts');
            const buffer = audioBufferCache.get(id);
            if (!buffer || buffer.sampleRate !== 48_000) {
                throw new Error('The literal source did not enter the authenticated48k cache');
            }
            const channel = buffer.getChannelData(0);
            return frames.map((frame) => channel[frame]);
        },
        { id: bufferId, frames: samples.map(([frame]) => frame) }
    );
    for (const [index, [frame, encoded]] of samples.entries()) {
        expectDecodedPcm16(actual[index], encoded, `authenticated source frame ${frame}`);
    }
}

async function setFixtureStretch(page: Page, clipId: string, rate: number): Promise<Snapshot> {
    // Established Punch setup contract; the gestures being qualified remain real pointer/menu actions.
    await page.evaluate(
        async ({ id, ratio }) => {
            const { executeUserAppAction } = await import('/src/modules/Command/useCases/index.ts');
            await executeUserAppAction({ type: 'setClipStretchMode', payload: { clipId: id, mode: 'repitch' } });
            await executeUserAppAction({ type: 'setClipStretchRatio', payload: { clipId: id, ratio } });
        },
        { id: clipId, ratio: rate }
    );
    await expect.poll(async () => onlyClip(await readSnapshot(page)).stretchRatio).toBe(rate);
    return readSnapshot(page);
}

async function interiorMap(page: Page, before: Snapshot): Promise<Snapshot> {
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    let state = before;
    for (const [beat, bpm] of [
        [0, 120],
        [1, 240],
        [2, 120],
    ]) {
        state = await addTempoEvent(page, beat, bpm, state);
    }
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    expect(state.raw.tempo.map(({ beat, tempo }) => [beat, tempo])).toEqual([
        [0, 120],
        [1, 240],
        [2, 120],
    ]);
    expect(interiorTempoSeconds(1.5)).toBe(0.625);
    expect(interiorTempoSeconds(2.5)).toBe(1);
    expect(interiorTempoSeconds(4)).toBe(1.75);
    return state;
}

async function zeroCrossingPreference(page: Page, enabled: boolean): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'General', exact: true }).click();
    const control = dialog.getByRole('switch', { name: 'Snap to Zero Crossing', exact: true });
    await expect(control).toBeVisible();
    if ((await control.getAttribute('aria-checked')) !== String(enabled)) {
        await control.click();
    }
    await expect(control).toHaveAttribute('aria-checked', String(enabled));
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
}

async function slipGesture(
    page: Page,
    before: Snapshot,
    mediaBeatDelta: number,
    previewSourceSeconds: number,
    previewProgramme?: [number, number][]
): Promise<Snapshot> {
    const clip = onlyClip(before);
    // Use the actual body midpoint. At the import overview zoom, half a beat
    // is only six pixels and can lie under the adjacent pane's resize hit area.
    const point = await canvasPoint(page, clip, (clip.startBeat + clip.endBeat) / 2);
    await expectCanvasAdmission(page, point.x, point.y);
    await page.keyboard.down(MOD);
    await page.keyboard.down('Shift');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    try {
        await expect(page.getByRole('menuitem', { name: 'Edit Clip', exact: true })).toHaveCount(0);
        // A one-pixel excursion back to origin forces the zero-delta preview path.
        if (mediaBeatDelta === 0) {
            await page.mouse.move(point.x + 1, point.y);
        }
        await page.mouse.move(point.x + mediaBeatDelta * point.pixelsPerBeat, point.y, { steps: 8 });
        await expect(page.getByRole('menuitem', { name: 'Edit Clip', exact: true })).toHaveCount(0);
        const preview = await waveform(page, before.trackId, clip.id);
        expect(preview.rectangle).toEqual({ startBeat: clip.startBeat, endBeat: clip.endBeat });
        expect(preview.occurrences[0]?.startSample).toBe(Math.floor(previewSourceSeconds * SAMPLE_RATE));
        if (previewProgramme) {
            expect(preview.programme).toHaveLength(previewProgramme.length);
            for (const [index, [startBeat, entry]] of previewProgramme.entries()) {
                expect(preview.programme?.[index]?.startBeat).toBeCloseTo(startBeat, 10);
                expect(preview.programme?.[index]?.audioOffsetSeconds).toBeCloseTo(entry, 10);
            }
        }
        // Preview is a reader overlay; the actual CRDT stays on its pre-gesture source.
        expect((await readSnapshot(page)).raw).toEqual(before.raw);
    } finally {
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await page.keyboard.up(MOD);
    }
    await expect
        .poll(async () => onlyClip(await readSnapshot(page)).audioOffsetSeconds)
        .toBeCloseTo(previewSourceSeconds, 10);
    const after = await readSnapshot(page);
    expect(after.raw).toEqual(after.projected);
    expect([onlyClip(after).startBeat, onlyClip(after).endBeat]).toEqual([clip.startBeat, clip.endBeat]);
    expect(onlyClip(after).audioUnwrappedOffsetSeconds).toBeCloseTo(previewSourceSeconds, 10);
    return after;
}

function expectZeroSpan(pcm: ReturnType<typeof pcm24Wav>, from: number, to: number, label: string): void {
    expect(pcm.frames, `${label}: exported frame count`).toBeGreaterThanOrEqual(to);
    for (let channel = 0; channel < 2; channel += 1) {
        let firstNonzero: { frame: number; value: number } | null = null;
        for (let frame = from; frame < to; frame += 1) {
            const value = pcm.at(frame, channel);
            if (value !== 0) {
                firstNonzero = { frame, value };
                break;
            }
        }
        expect(firstNonzero, `${label} channel${channel}: ${JSON.stringify(firstNonzero)}`).toBeNull();
    }
}

function expectRelativeStamps(
    pcm: ReturnType<typeof pcm24Wav>,
    stamps: { outputFrame: number; encoded: number }[]
): void {
    const reference = stamps[0];
    if (!reference) {
        throw new Error('The independent PCM stamp oracle is empty');
    }
    for (let channel = 0; channel < 2; channel += 1) {
        const level = pcm.at(reference.outputFrame, channel);
        expect(level, 'the literal positive reference stamp must sound').toBeGreaterThan(100_000);
        for (const stamp of stamps) {
            // This ratio removes only the unchanged linear mixer gain. The source
            // input/frame and expected amplitude come from the literal WAV writer.
            expect(pcm.at(stamp.outputFrame, channel) / level).toBeCloseTo(stamp.encoded / reference.encoded, 2);
        }
    }
}

function expectSlipPcm(pcm: ReturnType<typeof pcm24Wav>, entry: number, duration: number): void {
    const probes = [0.05, 0.3, 0.5];
    if (duration > 1.9) {
        probes.push(1.9);
    }
    expectRelativeStamps(
        pcm,
        probes.map((seconds) => ({
            outputFrame: Math.round(seconds * SAMPLE_RATE),
            encoded: physicalSourceFixture.slipSample(Math.round((entry + seconds) * SAMPLE_RATE)),
        }))
    );
    expectZeroSpan(pcm, Math.round(duration * SAMPLE_RATE), pcm.frames, 'slipped exclusive output tail');
}

async function splitAtPointer(page: Page, clip: SourceClip, beat: number): Promise<Snapshot> {
    const point = await canvasPoint(page, clip, beat);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const split = page.getByRole('menuitem', { name: 'Split at Cursor', exact: true });
    await expect(split).toBeVisible();
    await split.click();
    await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(2);
    const state = await readSnapshot(page);
    expect(state.raw).toEqual(state.projected);
    return state;
}

async function quarterEntryWithInteriorMap(page: Page, before: Snapshot): Promise<Snapshot> {
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    const state = await addTempoEvent(page, 0, 120, before);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    await slipGesture(page, state, 0.5, 0.25);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    await page.getByRole('button', { name: 'Remove tempo change at beat 0', exact: true }).click();
    await expect.poll(async () => (await readSnapshot(page)).raw.tempo.length).toBe(0);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    return interiorMap(page, await readSnapshot(page));
}

function expectIslandPcm(pcm: ReturnType<typeof pcm24Wav>): void {
    // E=.25 and rate2 put the literal source islands at these song frames.
    // Each10ms source detector window is480 frames; all six edges align exactly.
    expectRelativeStamps(pcm, [
        { outputFrame: 13_200, encoded: 8_192 },
        { outputFrame: 31_200, encoded: 16_384 },
        { outputFrame: 49_200, encoded: 24_576 },
    ]);
    for (const [from, to] of [
        [0, 12_000],
        [14_400, 30_000],
        [32_400, 48_000],
        [50_400, pcm.frames],
    ]) {
        expectZeroSpan(pcm, from, to, 'literal source-island silence');
    }
}

async function gainSatellites(page: Page) {
    return page.evaluate(async () => {
        const { gainEnvelopeStore, warpStateStore } = await import('/src/modules/Arrangement/stores/index.ts');
        return {
            envelopes: gainEnvelopeStore.value?.envelopes ?? {},
            warp: warpStateStore.value?.states ?? {},
        };
    });
}

async function expectCanvasAdmission(page: Page, x: number, y: number): Promise<void> {
    const target = await page.evaluate(
        ({ x, y }) => {
            const hit = document.elementFromPoint(x, y);
            return { tag: hit?.tagName, label: hit?.getAttribute('aria-label') };
        },
        { x, y }
    );
    expect(target, 'the normal pointer must reach the timeline rather than an adjacent resize handle').toEqual({
        tag: 'CANVAS',
        label: 'Timeline editor surface',
    });
}

async function trimPhysicalHead(page: Page, before: Snapshot, beat: number, sourceFrame: number): Promise<Snapshot> {
    const clip = onlyClip(before);
    const anchorBeat = (clip.startBeat + clip.endBeat) / 2;
    const point = await canvasPoint(page, clip, anchorBeat);
    // Eight pixels is inside the real10px left-edge hit area and clear of the pane divider.
    const from = point.x - (anchorBeat - clip.startBeat) * point.pixelsPerBeat + 8;
    await expectCanvasAdmission(page, from, point.y);
    await page.mouse.move(from, point.y);
    await page.mouse.down();
    try {
        await page.mouse.move(from + (beat - clip.startBeat) * point.pixelsPerBeat, point.y, { steps: 8 });
        const preview = await waveform(page, before.trackId, clip.id);
        expect(preview.rectangle.startBeat).toBeCloseTo(beat, 10);
        expect(preview.occurrences[0]?.startSample).toBe(sourceFrame);
        expect(preview.occurrences.at(-1)?.endSample).toBe(168_000);
        expect((await readSnapshot(page)).raw).toEqual(before.raw);
    } finally {
        await page.mouse.up();
    }
    await expect.poll(async () => onlyClip(await readSnapshot(page)).startBeat).toBeCloseTo(beat, 10);
    return readSnapshot(page);
}

function expectRateTwoTrimPcm(pcm: ReturnType<typeof pcm24Wav>, trimmed: boolean): void {
    if (trimmed) {
        expectZeroSpan(pcm, 0, 30_000, 'trimmed song prefix');
        expectRelativeStamps(pcm, [
            { outputFrame: 32_400, encoded: 12_288 },
            { outputFrame: 40_800, encoded: 16_384 },
            { outputFrame: 60_000, encoded: 24_576 },
        ]);
    } else {
        expectRelativeStamps(pcm, [
            { outputFrame: 4_800, encoded: 4_096 },
            { outputFrame: 19_200, encoded: 8_192 },
            { outputFrame: 33_600, encoded: 12_288 },
            { outputFrame: 62_400, encoded: 24_576 },
        ]);
    }
    for (let channel = 0; channel < 2; channel += 1) {
        expect(
            pcm.at(83_999, channel),
            'last destination frame remains positive before the excluded negative source'
        ).toBeGreaterThan(4_096);
    }
    expectZeroSpan(pcm, 84_000, pcm.frames, 'rate2 exact exclusive output tail');
}

test('keeps the selected source frame through tempo edits, comp, playback, export and saved replay', async ({
    page: initialPage,
}, info) => {
    test.setTimeout(480_000);
    const page = await bootOwnedSourceProject(initialPage, info);
    let state = await importSourceFixture(page, sourceWav(), 'source-frame-stamps.wav');
    const imported = onlyClip(state);
    expect(state.buffer).toMatchObject({ sampleRate: SAMPLE_RATE, frames: SAMPLE_RATE });
    expectDecodedPcm16(state.buffer.body[0], 8_192, 'base-gap body stamp');
    expectDecodedPcm16(state.buffer.body[1], 16_384, 'selected body stamp');
    expectDecodedPcm16(state.buffer.finalPositive, 24_576, 'last positive source frame');
    expectDecodedPcm16(state.buffer.firstNegative, -24_576, 'first excluded negative source frame');
    expect(imported.startBeat).toBe(0);
    expect(imported.endBeat).toBe(2);

    await test.step('trim and slip visibly to enter signed pre-roll', async () => {
        await dragEdge(page, imported, 'right', 1);
        await expect.poll(async () => (await readSnapshot(page)).raw.clips[0]?.endBeat).toBe(1);
        state = await readSnapshot(page);
        await page.keyboard.press('f');
        await expect
            .poll(async () =>
                page.evaluate(async () => {
                    const { timelineViewStore } = await import('/src/modules/Arrangement/stores/timelineViewStore.ts');
                    return timelineViewStore.value?.pixelsPerBeat;
                })
            )
            .toBe(80);
        const slip = await canvasPoint(page, onlyClip(state), 0.5);
        await page.keyboard.down('Control');
        await page.keyboard.down('Shift');
        try {
            await page.mouse.move(slip.x, slip.y);
            await page.mouse.down();
            await page.mouse.move(slip.x - 0.2 * slip.pixelsPerBeat, slip.y, { steps: 8 });
            await page.mouse.up();
        } finally {
            await page.keyboard.up('Shift');
            await page.keyboard.up('Control');
        }
        await expect.poll(async () => (await readSnapshot(page)).raw.clips[0]?.audioOffsetBeats).toBeCloseTo(-0.2, 5);
        state = await readSnapshot(page);
        expect(state.raw).toEqual(state.projected);
        await expect
            .poll(async () => (await readSnapshot(page)).mirror.past.at(-1)?.action?.type)
            .toBe('slipClipContent');
        expect(sourceEntrySeconds(onlyClip(state))).toBeCloseTo(-0.1, 8);
        const preRoll = await waveform(page, state.trackId, imported.id);
        expect(preRoll.occurrences).toHaveLength(1);
        expect(preRoll.occurrences[0]?.startSample).toBe(0);
        expect(preRoll.occurrences[0]?.audibleStartBeat).toBeCloseTo(0.2, 5);
    });

    await test.step('visible instant tempo rows preserve the signed source clock on both replay legs', async () => {
        await page.getByRole('button', { name: 'Toggle tempo map' }).click();
        const dialog = page.getByRole('dialog', { name: 'Tempo map editor' });
        await expect(dialog).toBeVisible();
        for (const [beat, bpm] of [
            [0, 120],
            [0.25, 240],
            [0.45, 120],
        ]) {
            state = await addTempoEvent(page, beat, bpm, state);
        }
        expect(state.raw.tempo.map(({ beat, tempo }) => [beat, tempo])).toEqual([
            [0, 120],
            [0.25, 240],
            [0.45, 120],
        ]);
        await page.getByRole('button', { name: 'Toggle tempo map' }).click();
        expect(songSeconds(0.25)).toBe(0.125);
        expect(songSeconds(0.45)).toBe(0.175);
        expect(songSeconds(0.5)).toBe(0.2);
        expect(songSeconds(1)).toBe(0.45);
        expect(songSeconds(1.5)).toBe(0.7);
        expect(songSeconds(2)).toBe(0.95);
        expectFrame(
            (await waveform(page, state.trackId, imported.id)).occurrences[0].endSample,
            EXCLUSIVE_SOURCE_FRAME,
            'three-event rendered end'
        );
        const threeEvents = state;
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(page)).raw.tempo.length).toBe(2);
        state = await readSnapshot(page);
        expect(state.raw).toEqual(state.projected);
        expect(state.raw.tempo).toEqual(threeEvents.raw.tempo.slice(0, 2));
        expect(sourceEntrySeconds(onlyClip(state))).toBeCloseTo(-0.1, 8);
        expect(songSeconds(1, false)).toBe(0.3125);
        expectFrame(
            (await waveform(page, state.trackId, imported.id)).occurrences[0].endSample,
            10_200,
            'two-event rendered end'
        );
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(page)).raw.tempo.length).toBe(3);
        state = await readSnapshot(page);
        expect(state.raw).toEqual(threeEvents.raw);
        expect(state.projected).toEqual(threeEvents.projected);
        expectFrame(
            (await waveform(page, state.trackId, imported.id)).occurrences[0].endSample,
            EXCLUSIVE_SOURCE_FRAME,
            'restored rendered end'
        );
    });

    await test.step('split, delete and move the source before selecting its ending take', async () => {
        const point = await canvasPoint(page, onlyClip(state), 0.5);
        await page.mouse.click(point.x, point.y, { button: 'right' });
        await page.getByRole('menuitem', { name: 'Split at Cursor', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(2);
        state = await readSnapshot(page);
        expect(state.raw).toEqual(state.projected);
        const [left, right] = [...state.raw.clips].sort((a, b) => a.startBeat - b.startBeat);
        if (!left || !right) {
            throw new Error('Actual split fragments are absent');
        }
        expect([left.startBeat, left.endBeat, right.startBeat, right.endBeat]).toEqual([0, 0.5, 0.5, 1]);
        expect(sourceEntrySeconds(left)).toBeCloseTo(-0.1, 8);
        expect(sourceEntrySeconds(right)).toBeCloseTo(0.1, 8);
        const leftWave = await waveform(page, state.trackId, left.id);
        expect(leftWave.occurrences[0]?.startSample).toBe(0);
        expect(leftWave.occurrences[0]?.audibleStartBeat).toBeCloseTo(0.2, 5);
        const leftPoint = await canvasPoint(page, left, 0.35);
        await page.mouse.click(leftPoint.x, leftPoint.y);
        await page.keyboard.press('Backspace');
        await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(1);
        state = await readSnapshot(page);
        expect(onlyClip(state).id).toBe(right.id);
        expect(sourceEntrySeconds(onlyClip(state))).toBeCloseTo(0.1, 8);
        const body = await canvasPoint(page, right, 0.75);
        await page.mouse.move(body.x, body.y);
        await page.mouse.down();
        await page.mouse.move(body.x + body.pixelsPerBeat, body.y, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => (await readSnapshot(page)).raw.clips[0]?.startBeat).toBe(1.5);
        state = await readSnapshot(page);
        expectSourceWindow(state, 1.5, 2, 0.1);
        state = await createComp(page, state);
    });

    const region = state.raw.lane?.activeCompRegions[0];
    if (!region) {
        throw new Error('Visible take selection has no persisted region');
    }
    const compStart = region.startBeat;
    const selectedSourceStart = 0.1 + songSeconds(compStart) - songSeconds(1.5);
    const baseDuration = songSeconds(compStart) - songSeconds(1.5);
    const selectedDuration = songSeconds(2) - songSeconds(compStart);
    const beforeTrim = state;
    await test.step('render, Web Audio and Bakery consume the same selected and base-gap source windows', async () => {
        const rendered = await waveform(page, state.trackId, onlyClip(state).id);
        expect(rendered.allClipRanges).toEqual([{ startBeat: 1.5, endBeat: 2 }]);
        expect(rendered.programme).toHaveLength(2);
        expect(rendered.programme?.map((part) => [part.startBeat, part.endBeat])).toEqual([
            [1.5, compStart],
            [compStart, 2],
        ]);
        expect(rendered.occurrences).toHaveLength(2);
        const ordered = [...rendered.occurrences].sort((a, b) => a.startSample - b.startSample);
        expect(ordered[0].startSample).toBe(4_800);
        // A fractional half-open end intersects its last PCM cell; the start
        // below still uses floor, and an exact integer end excludes that cell.
        expect(ordered[0].endSample).toBe(Math.ceil(selectedSourceStart * SAMPLE_RATE));
        expect(ordered[1].startSample).toBe(Math.floor(selectedSourceStart * SAMPLE_RATE));
        expect(ordered[1].endSample).toBe(EXCLUSIVE_SOURCE_FRAME);
        await info.attach('selected-waveform', { body: await page.screenshot(), contentType: 'image/png' });
        await observeStarts(page, state.buffer.id, 1.5, [
            [0.1, baseDuration],
            [selectedSourceStart, selectedDuration],
        ]);
        const pcm = await exportPcm(page);
        for (let channel = 0; channel < 2; channel += 1) {
            expect(pcm.at(24_000, channel)).toBe(0);
            const base = pcm.at(Math.round((songSeconds(1.5) + 0.025) * SAMPLE_RATE), channel);
            const selected = pcm.at(Math.round((songSeconds(compStart) + 0.05) * SAMPLE_RATE), channel);
            expect(base).toBeGreaterThan(100_000);
            expect(selected / base, 'distinct source body stamps must survive mixing').toBeGreaterThan(1.8);
            expect(selected / base).toBeLessThan(2.2);
        }
        expectExportEnd(pcm, Math.round((songSeconds(compStart) + 0.05) * SAMPLE_RATE));
    });

    await test.step('left trim, save, fresh reopen, Undo and Redo keep the exclusive last frame', async () => {
        await dragEdge(page, onlyClip(state), 'left', 1.75);
        await expect.poll(async () => (await readSnapshot(page)).raw.clips[0]?.startBeat).toBeGreaterThan(1.72);
        state = await readSnapshot(page);
        const trimStart = onlyClip(state).startBeat;
        expect(trimStart).toBeLessThan(1.78);
        expect(trimStart).toBeGreaterThanOrEqual(compStart);
        const trimEntry = 0.1 + songSeconds(trimStart) - songSeconds(1.5);
        expectSourceWindow(state, trimStart, 2, trimEntry);
        const trimmed = await waveform(page, state.trackId, onlyClip(state).id);
        expect(trimmed.programme).toHaveLength(1);
        expect(trimmed.programme?.[0]?.startBeat).toBeCloseTo(trimStart, 5);
        expect(trimmed.occurrences).toHaveLength(1);
        expect(trimmed.occurrences[0].startSample).toBe(Math.floor(trimEntry * SAMPLE_RATE));
        expect(trimmed.occurrences[0].endSample).toBe(EXCLUSIVE_SOURCE_FRAME);
        await observeStarts(page, state.buffer.id, trimStart, [[trimEntry, songSeconds(2) - songSeconds(trimStart)]]);
        expectExportEnd(await exportPcm(page), Math.round((songSeconds(trimStart) + 0.05) * SAMPLE_RATE));
        const trimmedState = state;
        let fresh = await saveAndReopen(page, info, trimmedState);
        await fresh.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(fresh)).raw.clips[0]?.startBeat).toBe(1.5);
        state = await readSnapshot(fresh);
        expect(state.raw).toEqual(beforeTrim.raw);
        expect(state.projected).toEqual(beforeTrim.projected);
        const undoneWave = await waveform(fresh, state.trackId, onlyClip(state).id);
        expect(undoneWave.occurrences.at(-1)?.endSample).toBe(EXCLUSIVE_SOURCE_FRAME);
        await observeStarts(fresh, state.buffer.id, 1.5, [
            [0.1, baseDuration],
            [selectedSourceStart, selectedDuration],
        ]);
        expectExportEnd(await exportPcm(fresh), Math.round((songSeconds(compStart) + 0.05) * SAMPLE_RATE));
        fresh = await saveAndReopen(fresh, info, state);
        await fresh.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(fresh)).raw.clips[0]?.startBeat).toBeCloseTo(trimStart, 5);
        state = await readSnapshot(fresh);
        expect(state.raw).toEqual(trimmedState.raw);
        expect(state.projected).toEqual(trimmedState.projected);
        const redoneWave = await waveform(fresh, state.trackId, onlyClip(state).id);
        expect(redoneWave.occurrences[0]?.endSample).toBe(EXCLUSIVE_SOURCE_FRAME);
        await observeStarts(fresh, state.buffer.id, trimStart, [[trimEntry, songSeconds(2) - songSeconds(trimStart)]]);
        expectExportEnd(await exportPcm(fresh), Math.round((songSeconds(trimStart) + 0.05) * SAMPLE_RATE));
        await info.attach('source-time-final-owners', {
            body: JSON.stringify(state, null, 2),
            contentType: 'application/json',
        });
        await fresh.close();
    });
});

test('slips canonical media and manual comp snapshots from authoritative seconds after a head-tempo edit', async ({
    page: initialPage,
}, info) => {
    test.setTimeout(480_000);
    let page = await bootOwnedSourceProject(initialPage, info);
    let state = await importSourceFixture(page, physicalSourceFixture.slip(), 'canonical-slip-stamps.wav');
    await authenticateSamples(page, state.buffer.id, [
        [14_400, 4_096],
        [19_200, 8_192],
        [28_800, 16_384],
        [45_600, 24_576],
    ]);
    await dragEdge(page, onlyClip(state), 'right', 2);
    await expect.poll(async () => onlyClip(await readSnapshot(page)).endBeat).toBe(2);
    state = await readSnapshot(page);
    // Normal Zoom to Fit makes the .2/.1-media-beat gestures whole CSS pixels.
    await page.keyboard.press('f');
    await expect
        .poll(async () =>
            page.evaluate(async () => {
                const { timelineViewStore } = await import('/src/modules/Arrangement/stores/timelineViewStore.ts');
                return timelineViewStore.value?.pixelsPerBeat;
            })
        )
        .toBe(80);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    state = await addTempoEvent(page, 0, 120, state);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();

    state = await slipGesture(page, state, 0.5, 0.25);
    expect(onlyClip(state).audioOffsetBeats).toBeCloseTo(0.5, 10);
    const quarterEntry = state;
    state = await slipGesture(page, state, 0.2, 0.35);
    expect(onlyClip(state).audioOffsetBeats).toBeCloseTo(0.7, 10);
    await observeStarts(page, state.buffer.id, 0, [[0.35, 1]]);
    expectSlipPcm(await exportPcm(page), 0.35, 1);

    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    const tempoDialog = page.getByRole('dialog', { name: 'Tempo map editor' });
    await tempoDialog.getByRole('button', { name: '120 BPM at beat 0. Click to edit.', exact: true }).click();
    const tempoInput = tempoDialog.getByRole('spinbutton', { name: 'Edit tempo at beat 0', exact: true });
    await tempoInput.fill('60');
    await tempoInput.press('Enter');
    await expect.poll(async () => (await readSnapshot(page)).raw.tempo[0]?.tempo).toBe(60);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    state = await readSnapshot(page);
    expect(onlyClip(state).audioOffsetSeconds).toBeCloseTo(0.35, 10);
    expect(onlyClip(state).audioUnwrappedOffsetSeconds).toBeCloseTo(0.35, 10);
    // q=.7 remains a compatibility capture; at60BPM it would wrongly mean .7s.
    expect(onlyClip(state).audioOffsetBeats).toBeCloseTo(0.7, 10);
    const beforeZero = state;
    state = await slipGesture(page, state, 0, 0.35);
    expect(state.raw).toEqual(beforeZero.raw);
    expect(state.mirror.past).toEqual(beforeZero.mirror.past);
    expectSlipPcm(await exportPcm(page), 0.35, 2);

    // Current media-beat origin is U*60/60=.35, so +.2 enters .55, not stale q+.2=.9.
    state = await slipGesture(page, state, 0.2, 0.55);
    expect(onlyClip(state).audioOffsetBeats).toBeCloseTo(0.55, 10);
    expect((await waveform(page, state.trackId, onlyClip(state).id)).occurrences[0]?.endSample).toBe(122_400);
    await observeStarts(page, state.buffer.id, 0, [[0.55, 2]]);
    expectSlipPcm(await exportPcm(page), 0.55, 2);
    state = await createComp(page, state);
    const beforeCompSlip = state;
    const compStart = state.raw.lane?.activeCompRegions[0]?.startBeat;
    if (compStart === undefined) {
        throw new Error('The real manual comp selection is absent');
    }
    const takeFields = structuredClone(state.raw.lane?.takes);
    state = await slipGesture(page, state, 0.1, 0.65, [
        [0, 0.65],
        [compStart, 0.65 + compStart],
    ]);
    expect(state.raw.lane?.takes).toEqual(takeFields);
    expect(state.raw.lane?.activeCompRegions[0]?.audioSource).toMatchObject({
        startBeat: compStart,
        audioOffsetSeconds: 0.65 + compStart,
        audioLoopStartSeconds: 0.65 + compStart,
        audioLoopPassEntrySeconds: 0.65 + compStart,
        audioLoopPassOriginBeat: compStart,
        loopOriginBeat: compStart,
        loopLength: 2 - compStart,
    });
    expect(state.raw.lane?.baseGapAudioSources).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                clipId: onlyClip(state).id,
                startBeat: 0,
                endBeat: compStart,
                audioSource: expect.objectContaining({
                    startBeat: 0,
                    audioOffsetSeconds: 0.65,
                    audioLoopPassOriginBeat: 0,
                }),
            }),
        ])
    );
    await observeStarts(page, state.buffer.id, 0, [
        [0.65, compStart],
        [0.65 + compStart, 2 - compStart],
    ]);
    expectSlipPcm(await exportPcm(page), 0.65, 2);
    const committed = state;
    page = await saveAndReopen(page, info, committed);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => onlyClip(await readSnapshot(page)).audioOffsetSeconds).toBeCloseTo(0.55, 10);
    state = await readSnapshot(page);
    expect(state.raw).toEqual(beforeCompSlip.raw);
    expect(state.projected).toEqual(beforeCompSlip.projected);
    expectSlipPcm(await exportPcm(page), 0.55, 2);
    page = await saveAndReopen(page, info, state);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => onlyClip(await readSnapshot(page)).audioOffsetSeconds).toBeCloseTo(0.65, 10);
    state = await readSnapshot(page);
    expect(state.raw).toEqual(committed.raw);
    expect(state.projected).toEqual(committed.projected);
    expect(state.raw.lane?.takes).toEqual(takeFields);
    await observeStarts(page, state.buffer.id, 0, [
        [0.65, compStart],
        [0.65 + compStart, 2 - compStart],
    ]);
    expectSlipPcm(await exportPcm(page), 0.65, 2);
    await info.attach('canonical-slip-and-manual-comp-owners', {
        body: JSON.stringify(
            {
                quarterEntry,
                beforeZero,
                beforeCompSlip,
                committed,
                replayed: state,
                browserLimit:
                    'Manual/unplaced takes only. Placed-pass basis is covered by owner production-reader/session tests, not this browser case.',
            },
            null,
            2
        ),
        contentType: 'application/json',
    });
});

test('snaps real menu splits to source-frame zero crossings through interior tempo and rate2', async ({
    page: initialPage,
}, info) => {
    test.setTimeout(480_000);
    let page = await bootOwnedSourceProject(initialPage, info);
    let state = await importSourceFixture(page, physicalSourceFixture.crossings(), 'interior-source-crossings.wav');
    await authenticateSamples(page, state.buffer.id, [
        [42_002, 12_288],
        [42_003, -12_288],
        [48_000, -12_288],
        [108_002, -12_288],
        [108_003, 12_288],
    ]);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    state = await addTempoEvent(page, 0, 120, state);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    await slipGesture(page, state, 0.5, 0.25);
    // Remove the flat setup row through the real UI before installing the three-event map.
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    await page.getByRole('button', { name: 'Remove tempo change at beat 0', exact: true }).click();
    await expect.poll(async () => (await readSnapshot(page)).raw.tempo.length).toBe(0);
    await page.getByRole('button', { name: 'Toggle tempo map' }).click();
    state = await interiorMap(page, await readSnapshot(page));
    await zeroCrossingPreference(page, true);

    const controls = [
        {
            rate: 1,
            proposedBeat: 1.5,
            sourceFrame: 42_002,
            snappedBeat: 1.5 + 8 / SAMPLE_RATE,
            sourceEndFrame: 192_000,
        },
        {
            rate: 2,
            proposedBeat: 2.5,
            sourceFrame: 108_002,
            snappedBeat: 2.5 + 2 / SAMPLE_RATE,
            sourceEndFrame: 180_000,
        },
    ];
    for (const control of controls) {
        if (control.rate === 2) {
            state = await setFixtureStretch(page, onlyClip(state).id, 2);
        }
        const before = state;
        state = await splitAtPointer(page, onlyClip(state), control.proposedBeat);
        const parts = [...state.raw.clips].sort((a, b) => a.startBeat - b.startBeat);
        const left = parts[0];
        const right = parts[1];
        if (!left || !right) {
            throw new Error('The admitted split did not produce both owners');
        }
        expect(left.endBeat).toBeCloseTo(control.snappedBeat, 10);
        expect(right.startBeat).toBeCloseTo(control.snappedBeat, 10);
        expect(right.audioOffsetSeconds).toBe(control.sourceFrame / SAMPLE_RATE);
        expectFrame(
            (await waveform(page, state.trackId, right.id)).occurrences[0].startSample,
            control.sourceFrame,
            'snapped physical head'
        );
        expectFrame(
            (await waveform(page, state.trackId, right.id)).occurrences.at(-1)?.endSample ?? -1,
            control.sourceEndFrame,
            'snapped exclusive source end'
        );
        await observeStarts(
            page,
            state.buffer.id,
            right.startBeat,
            [[control.sourceFrame / SAMPLE_RATE, (control.sourceEndFrame - control.sourceFrame) / SAMPLE_RATE]],
            control.rate
        );
        const pcm = await exportPcm(page);
        const probes = control.rate === 1 ? [0.2, 0.8, 2.5] : [0.1, 0.5, 1.2];
        for (let channel = 0; channel < 2; channel += 1) {
            expect(pcm.at(Math.round(probes[0] * SAMPLE_RATE), channel)).toBeGreaterThan(100_000);
            expect(pcm.at(Math.round(probes[1] * SAMPLE_RATE), channel)).toBeLessThan(-100_000);
            expect(pcm.at(Math.round(probes[2] * SAMPLE_RATE), channel)).toBeGreaterThan(100_000);
        }
        const outputEnd = control.rate === 1 ? 180_000 : 84_000;
        expectZeroSpan(pcm, outputEnd, pcm.frames, 'split exact exclusive output tail');
        const committed = state;
        page = await saveAndReopen(page, info, state);
        const reopenedWave = await waveform(page, state.trackId, right.id);
        expectFrame(reopenedWave.occurrences[0].startSample, control.sourceFrame, 'saved split physical head');
        expectFrame(
            reopenedWave.occurrences.at(-1)?.endSample ?? -1,
            control.sourceEndFrame,
            'saved split exclusive source end'
        );
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(1);
        state = await readSnapshot(page);
        expect(state.raw).toEqual(before.raw);
        expect(state.projected).toEqual(before.projected);
        const undoneWave = await waveform(page, state.trackId, onlyClip(state).id);
        expectFrame(undoneWave.occurrences[0].startSample, 12_000, 'saved split Undo physical head');
        expectFrame(
            undoneWave.occurrences.at(-1)?.endSample ?? -1,
            control.sourceEndFrame,
            'saved split Undo exclusive source end'
        );
        page = await saveAndReopen(page, info, state);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(2);
        state = await readSnapshot(page);
        expect(state.raw).toEqual(committed.raw);
        expect(state.projected).toEqual(committed.projected);
        const redoneWave = await waveform(page, state.trackId, right.id);
        expectFrame(redoneWave.occurrences[0].startSample, control.sourceFrame, 'saved split Redo physical head');
        expectFrame(
            redoneWave.occurrences.at(-1)?.endSample ?? -1,
            control.sourceEndFrame,
            'saved split Redo exclusive source end'
        );
        await observeStarts(
            page,
            state.buffer.id,
            right.startBeat,
            [[control.sourceFrame / SAMPLE_RATE, (control.sourceEndFrame - control.sourceFrame) / SAMPLE_RATE]],
            control.rate
        );
        // Restore the one imported owner before the next rate control.
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(1);
        state = await readSnapshot(page);
        expect(state.raw).toEqual(before.raw);
    }
    await info.attach('interior-zero-crossing-source-controls', {
        body: JSON.stringify({ controls, final: state }, null, 2),
        contentType: 'application/json',
    });
});

test('strips literal source islands through interior tempo at rate2 and preserves in-session replay and saved PCM', async ({
    page: initialPage,
}, info) => {
    test.setTimeout(480_000);
    let page = await bootOwnedSourceProject(initialPage, info);
    let state = await importSourceFixture(page, physicalSourceFixture.islands(), 'literal-source-islands.wav');
    await authenticateSamples(page, state.buffer.id, [
        [35_999, 0],
        [36_000, 8_192],
        [40_800, 0],
        [72_000, 16_384],
        [108_000, 24_576],
        [112_800, 0],
    ]);
    state = await quarterEntryWithInteriorMap(page, state);
    state = await setFixtureStretch(page, onlyClip(state).id, 2);
    const original = onlyClip(state);
    expect([original.startBeat, original.endBeat, original.audioOffsetSeconds]).toEqual([0, 4, 0.25]);
    // A real public point action authors a nonempty, unity-gain satellite.
    await page.evaluate(async (clipId) => {
        const { executeUserAppAction } = await import('/src/modules/Command/useCases/index.ts');
        await executeUserAppAction({ type: 'addGainEnvelopePoint', payload: { clipId, beatOffset: 4, gainDb: 0 } });
    }, original.id);
    const before = await readSnapshot(page);
    const beforeSatellites = await gainSatellites(page);
    const originalEnvelope = beforeSatellites.envelopes[original.id];
    expect(originalEnvelope.points).toHaveLength(2);
    expect(originalEnvelope.points.map((point) => [point.beatOffset, point.gainDb])).toEqual([
        [0, 0],
        [4, 0],
    ]);
    await observeStarts(page, state.buffer.id, 0, [[0.25, 3.5]], 2);
    expectIslandPcm(await exportPcm(page));

    const point = await canvasPoint(page, original, 1.5);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const strip = page.getByRole('menuitem', { name: 'Strip Silence', exact: true });
    await expect(strip).toBeVisible();
    await strip.click();
    await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(3);
    state = await readSnapshot(page);
    expect(state.raw).toEqual(state.projected);
    const children = [...state.raw.clips].sort((a, b) => a.startBeat - b.startBeat);
    expect(new Set(children.map((clip) => clip.id)).size).toBe(3);
    expect(children.map((clip) => clip.id)).not.toContain(original.id);
    const windows = [
        [0.5, 0.6, 0.75, 36_000, 40_800],
        [1.5, 1.7, 1.5, 72_000, 76_800],
        [2.5, 2.6, 2.25, 108_000, 112_800],
    ];
    const satellites = await gainSatellites(page);
    expect(satellites.envelopes[original.id]).toBeUndefined();
    expect(satellites.warp).toEqual(beforeSatellites.warp);
    for (const [index, child] of children.entries()) {
        const [start, end, entry, first, exclusive] = windows[index];
        expect(child.startBeat).toBeCloseTo(start, 10);
        expect(child.endBeat).toBeCloseTo(end, 10);
        expect(child.audioOffsetSeconds).toBeCloseTo(entry, 12);
        expect(child.audioBufferId).toBe(original.audioBufferId);
        expect(child.stretchRatio).toBe(2);
        const rendered = await waveform(page, state.trackId, child.id);
        expectFrame(rendered.occurrences[0].startSample, first, 'strip child physical head');
        expectFrame(rendered.occurrences.at(-1)?.endSample ?? -1, exclusive, 'strip child exclusive source end');
        expect(satellites.envelopes[child.id]).toEqual({
            clipId: child.id,
            enabled: originalEnvelope.enabled,
            points: originalEnvelope.points.map((gain) => ({ ...gain, beatOffset: gain.beatOffset - child.startBeat })),
        });
    }
    await observeStarts(
        page,
        state.buffer.id,
        0.5,
        [
            [0.75, 0.1],
            [1.5, 0.1],
            [2.25, 0.1],
        ],
        2
    );
    expectIslandPcm(await exportPcm(page));
    const committed = state;
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(1);
    state = await readSnapshot(page);
    expect(state.raw).toEqual(before.raw);
    expect(state.projected).toEqual(before.projected);
    expect(await gainSatellites(page)).toEqual(beforeSatellites);
    expectIslandPcm(await exportPcm(page));
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await readSnapshot(page)).raw.clips.length).toBe(3);
    state = await readSnapshot(page);
    expect(state.raw).toEqual(committed.raw);
    expect(state.projected).toEqual(committed.projected);
    expect(await gainSatellites(page)).toEqual(satellites);
    expectIslandPcm(await exportPcm(page));
    page = await saveAndReopen(page, info, state);
    expect(await gainSatellites(page)).toEqual(satellites);
    await authenticateSamples(page, state.buffer.id, [
        [36_000, 8_192],
        [72_000, 16_384],
        [108_000, 24_576],
    ]);
    await observeStarts(
        page,
        state.buffer.id,
        0.5,
        [
            [0.75, 0.1],
            [1.5, 0.1],
            [2.25, 0.1],
        ],
        2
    );
    expectIslandPcm(await exportPcm(page));
    await info.attach('strip-source-islands-and-history-boundary', {
        body: JSON.stringify(
            {
                windows,
                before,
                committed,
                satellites,
                historyLimit:
                    'Undo/Redo is proved before Save. Binary fragments/PCM survive reload; persisted Strip history is separate issue#5740.',
            },
            null,
            2
        ),
        contentType: 'application/json',
    });
});

test('left trims rate2 across an interior tempo event with exact source ending and saved UndoRedo', async ({
    page: initialPage,
}, info) => {
    test.setTimeout(480_000);
    let page = await bootOwnedSourceProject(initialPage, info);
    let state = await importSourceFixture(page, physicalSourceFixture.stretchedTrim(), 'rate2-trim-ending.wav');
    await authenticateSamples(page, state.buffer.id, [
        [60_000, 12_288],
        [72_000, 16_384],
        [96_000, 24_576],
        [167_999, 24_576],
        [168_000, -24_576],
    ]);
    state = await setFixtureStretch(page, onlyClip(state).id, 2);
    state = await interiorMap(page, state);
    const before = state;
    expect([onlyClip(state).startBeat, onlyClip(state).endBeat, onlyClip(state).audioOffsetSeconds]).toEqual([0, 4, 0]);
    state = await trimPhysicalHead(page, before, 1.5, 60_000);
    const trimmed = onlyClip(state);
    expect([trimmed.startBeat, trimmed.endBeat, trimmed.audioOffsetSeconds]).toEqual([1.5, 4, 1.25]);
    expect(trimmed.audioUnwrappedOffsetSeconds).toBe(0.625);
    const rendered = await waveform(page, state.trackId, trimmed.id);
    expectFrame(rendered.occurrences[0].startSample, 60_000, 'rate2 trimmed head');
    expectFrame(rendered.occurrences.at(-1)?.endSample ?? -1, 168_000, 'rate2 exclusive source end');
    // Native start duration is SOURCE seconds:2.25 consumed at rate2 takes1.125 song seconds.
    await observeStarts(page, state.buffer.id, 1.5, [[1.25, 2.25]], 2);
    expectRateTwoTrimPcm(await exportPcm(page), true);
    const committed = state;
    page = await saveAndReopen(page, info, state);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => onlyClip(await readSnapshot(page)).startBeat).toBe(0);
    state = await readSnapshot(page);
    expect(state.raw).toEqual(before.raw);
    expect(state.projected).toEqual(before.projected);
    expectFrame(
        (await waveform(page, state.trackId, onlyClip(state).id)).occurrences[0].startSample,
        0,
        'saved trim Undo physical head'
    );
    await observeStarts(page, state.buffer.id, 0, [[0, 3.5]], 2);
    expectRateTwoTrimPcm(await exportPcm(page), false);
    page = await saveAndReopen(page, info, state);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => onlyClip(await readSnapshot(page)).startBeat).toBe(1.5);
    state = await readSnapshot(page);
    expect(state.raw).toEqual(committed.raw);
    expect(state.projected).toEqual(committed.projected);
    await observeStarts(page, state.buffer.id, 1.5, [[1.25, 2.25]], 2);
    expectRateTwoTrimPcm(await exportPcm(page), true);
    await info.attach('rate2-trim-physical-input-and-replay', {
        body: JSON.stringify(
            {
                before,
                committed,
                replayed: state,
                firstSourceFrame: 60_000,
                exclusiveSourceFrame: 168_000,
                exclusiveOutputFrame: 84_000,
                carrier: 'Chromium repitch AudioBufferSource rate2 and Bakery PCM; no physical device-clock claim.',
            },
            null,
            2
        ),
        contentType: 'application/json',
    });
});
