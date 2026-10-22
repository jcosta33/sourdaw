import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { stringify } from 'superjson';

import { type AppAction } from '../../src/utils/handlerContract';

import { enable_direct_e2e_viewport, launch_new_project } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const MIDI_NAME = 'Undo acceptance MIDI';
const SAMPLE_RATE = 44_100;
const STEP_TIMEOUT = 30_000;

test.use({ actionTimeout: STEP_TIMEOUT, navigationTimeout: STEP_TIMEOUT });

type Clip = {
    id: string;
    trackId: string;
    name: string;
    type: string;
    startBeat: number;
    endBeat: number;
    audioBufferId?: string;
};
type Track = { id: string; name: string; clips: Clip[] };
type MirroredEntry = {
    kind: string;
    groupId?: string;
    action?: AppAction;
    inverseAction?: AppAction;
    redoAction?: AppAction;
};
type Mirror = { projectId?: string; witness?: string; past: MirroredEntry[]; future: MirroredEntry[] };
type Snapshot = {
    projectId: string;
    witness: string;
    tracks: Track[];
    mirror: Mirror;
    exact: unknown;
    inspection: { projectInvariantsValid: boolean; audioGraphValid: boolean };
    counts: { notes: number; controllers: number; takes: number; compRegions: number; automationPoints: number };
};

function sineWav(): Buffer {
    const samples = SAMPLE_RATE * 4;
    const result = Buffer.alloc(44 + samples * 2);
    result.write('RIFF', 0);
    result.writeUInt32LE(result.length - 8, 4);
    result.write('WAVEfmt ', 8);
    result.writeUInt32LE(16, 16);
    result.writeUInt16LE(1, 20);
    result.writeUInt16LE(1, 22);
    result.writeUInt32LE(SAMPLE_RATE, 24);
    result.writeUInt32LE(SAMPLE_RATE * 2, 28);
    result.writeUInt16LE(2, 32);
    result.writeUInt16LE(16, 34);
    result.write('data', 36);
    result.writeUInt32LE(samples * 2, 40);
    for (let sample = 0; sample < samples; sample += 1) {
        result.writeInt16LE(Math.round(Math.sin((sample * 440 * Math.PI * 2) / SAMPLE_RATE) * 12_000), 44 + sample * 2);
    }
    return result;
}

function midiFile(): Buffer {
    const vlq = (value: number): number[] => {
        const bytes = [value & 127];
        for (let remainder = value >>> 7; remainder > 0; remainder >>>= 7) {
            bytes.unshift((remainder & 127) | 128);
        }
        return bytes;
    };
    const name = [...Buffer.from(MIDI_NAME)];
    const events = Buffer.from([
        0,
        255,
        3,
        ...vlq(name.length),
        ...name,
        0,
        255,
        81,
        3,
        7,
        161,
        32,
        0,
        144,
        60,
        100,
        ...vlq(480),
        176,
        1,
        20,
        ...vlq(960),
        176,
        1,
        100,
        ...vlq(1920),
        176,
        1,
        40,
        ...vlq(480),
        128,
        60,
        0,
        0,
        255,
        47,
        0,
    ]);
    const header = Buffer.alloc(14);
    header.write('MThd');
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(1, 10);
    header.writeUInt16BE(480, 12);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(events.length);
    return Buffer.concat([header, Buffer.from('MTrk'), length, events]);
}

async function palette(page: Page, label: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeVisible();
    await input.fill(label);
    const option = page.getByRole('option').filter({ has: page.getByText(label, { exact: true }) });
    await expect(option).toBeVisible({ timeout: 5_000 });
    await option.click();
    await expect(input).toHaveCount(0);
}

function trackRow(page: Page, name: string): Locator {
    return page
        .getByRole('grid', { name: 'Track list', exact: true })
        .locator('[role="row"][draggable="true"]')
        .filter({ has: page.getByText(name, { exact: true }) });
}

async function importIntoTrack(page: Page, trackName: string, kind: 'Audio' | 'MIDI'): Promise<void> {
    await trackRow(page, trackName).click({ button: 'right', position: { x: 8, y: 8 } });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: new RegExp(`Import ${kind}`, 'i') }).click();
    let file;
    if (kind === 'Audio') {
        file = { name: 'undo-source.wav', mimeType: 'audio/wav', buffer: sineWav() };
    } else {
        file = { name: 'undo-source.mid', mimeType: 'audio/midi', buffer: midiFile() };
    }
    await (await chooser).setFiles(file);
}

async function readSnapshot(page: Page): Promise<Snapshot> {
    const serializedSnapshot = await page.evaluate(async () => {
        const arrangementPath = '/src/modules/Arrangement/stores/index.ts';
        const midiPath = '/src/modules/MIDI/stores/index.ts';
        const automationPath = '/src/modules/Automation/stores/index.ts';
        const projectPath = '/src/modules/Project/stores/index.ts';
        const crdtPath = '/src/modules/CrdtDocument/useCases/index.ts';
        const inspectionPath = '/src/modules/CrdtDocument/useCases/agentProjectInspectionPort.ts';
        const audioPath = '/src/modules/AudioEngine/useCases/index.ts';
        const arrangement: typeof import('../../src/modules/Arrangement/stores') = await import(arrangementPath);
        const midi: typeof import('../../src/modules/MIDI/stores') = await import(midiPath);
        const automation: typeof import('../../src/modules/Automation/stores') = await import(automationPath);
        const project: typeof import('../../src/modules/Project/stores') = await import(projectPath);
        const crdt: typeof import('../../src/modules/CrdtDocument/useCases') = await import(crdtPath);
        const {
            agentProjectInspectionPort,
        }: typeof import('../../src/modules/CrdtDocument/useCases/agentProjectInspectionPort') = await import(
            inspectionPath
        );
        const audio: typeof import('../../src/modules/AudioEngine/useCases') = await import(audioPath);
        const document = crdt.getCrdtDoc('root');
        const projectState = project.projectStore.value;
        const tracks = arrangement.trackStore.value?.tracks;
        if (!document || !tracks || !projectState?.projectId || !projectState.initialized || projectState.loading) {
            throw new Error('The actual saved project has not hydrated');
        }
        if (!agentProjectInspectionPort.isConfigured()) {
            throw new Error('Production project inspection is not configured');
        }
        const inspection = agentProjectInspectionPort.inspect({ projectDocument: document, targetIds: [] });
        if (!inspection) {
            throw new Error('Production project inspection returned no evidence');
        }
        const witness = crdt.captureDurableDocumentWitness();
        const rootTracks = document.tracks;
        if (typeof rootTracks !== 'object' || rootTracks === null || !('tracks' in rootTracks)) {
            throw new Error('Raw track ownership is absent');
        }
        // UI selection and project save timestamps are not clip-edit content.
        const exact = {
            raw: {
                tracks: rootTracks.tracks,
                midi: document.midi,
                automation: document.automation,
                takeLanes: document.takeLanes,
                gainEnvelopes: document.gainEnvelopes,
            },
            projected: {
                tracks,
                midi: midi.midiStore.value,
                automation: automation.automationStore.value,
                takeLanes: arrangement.takeLaneStore.value,
                gainEnvelopes: arrangement.gainEnvelopeStore.value,
            },
        };
        const bufferIds = [
            ...new Set(
                tracks
                    .flatMap((track) => track.clips)
                    .flatMap((clip) => (clip.audioBufferId ? [clip.audioBufferId] : []))
            ),
        ].sort();
        const pcm = [];
        for (const bufferId of bufferIds) {
            const buffer = audio.getCachedAudioBuffer({ bufferId });
            if (!buffer) {
                throw new Error(`Hydrated source PCM is unavailable: ${bufferId}`);
            }
            const channels = [];
            for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
                const data = buffer.getChannelData(channel).slice();
                const digest = await crypto.subtle.digest('SHA-256', data.buffer);
                channels.push(
                    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
                );
            }
            pcm.push({ bufferId, sampleRate: buffer.sampleRate, frames: buffer.length, channels });
        }
        if (crdt.captureDurableDocumentWitness() !== witness) {
            throw new Error('Project changed while reading acceptance evidence');
        }
        const serialized = sessionStorage.getItem('sourdaw-undo-session');
        if (!serialized) {
            throw new Error('Production session action mirror is absent');
        }
        return JSON.stringify({
            projectId: projectState.projectId,
            witness,
            tracks,
            mirror: JSON.parse(serialized),
            exact: { ...exact, pcm },
            inspection,
            counts: {
                notes: Object.values(midi.midiStore.value?.notesByClipId ?? {}).flat().length,
                controllers: Object.values(midi.midiStore.value?.ccByClipId ?? {}).flat().length,
                takes: arrangement.takeLaneStore.value?.lanes.flatMap((lane) => lane.takes).length ?? 0,
                compRegions:
                    arrangement.takeLaneStore.value?.lanes.flatMap((lane) => lane.activeCompRegions).length ?? 0,
                automationPoints: automation.automationStore.value?.lanes.flatMap((lane) => lane.points).length ?? 0,
            },
        });
    });
    return JSON.parse(serializedSnapshot);
}

async function expectExact(page: Page, expected: Snapshot): Promise<Snapshot> {
    await expect
        .poll(
            () =>
                page.evaluate(async (projectId: string) => {
                    const path = '/src/modules/Project/stores/index.ts';
                    const { projectStore }: typeof import('../../src/modules/Project/stores') = await import(path);
                    const state = projectStore.value;
                    return state?.initialized === true && state.loading === false && state.projectId === projectId;
                }, expected.projectId),
            { timeout: STEP_TIMEOUT }
        )
        .toBe(true);
    await expect.poll(async () => (await readSnapshot(page)).exact, { timeout: STEP_TIMEOUT }).toEqual(expected.exact);
    const actual = await readSnapshot(page);
    expect(actual.projectId).toBe(expected.projectId);
    expect(actual.inspection).toMatchObject({ projectInvariantsValid: true, audioGraphValid: true });
    return actual;
}

function requireMirror(
    snapshot: Snapshot,
    side: 'past' | 'future',
    types: string[],
    removeRipple = false
): MirroredEntry[] {
    expect(snapshot.mirror.projectId).toBe(snapshot.projectId);
    expect(snapshot.mirror.witness).toBe(snapshot.witness);
    const entries =
        side === 'past' ? snapshot.mirror.past.slice(-types.length) : snapshot.mirror.future.slice(0, types.length);
    expect(entries.map((entry) => entry.action?.type).sort()).toEqual([...types].sort());
    for (const entry of entries) {
        expect(entry.kind).toBe('action');
        expect(entry.inverseAction?.type).toBeTruthy();
        if (entry.action?.type === 'removeClip') {
            // New removal entries bind their actual forward Ripple choice.
            // Legacy entries without this metadata remain covered by unit tests.
            expect(entry.inverseAction?.type).toBe('restoreClip');
            expect(entry.action.payload.clipId).toEqual(expect.any(String));
            expect(entry.redoAction).toEqual({
                type: 'removeClip',
                payload: { clipId: entry.action.payload.clipId, ripple: removeRipple },
            });
        } else {
            expect(entry.redoAction?.type).toBeTruthy();
        }
    }
    if (types.length > 1) {
        expect(entries[0]?.groupId).toBeTruthy();
        expect(new Set(entries.map((entry) => entry.groupId)).size).toBe(1);
    }
    return entries;
}

async function save(page: Page, requireWitness = true): Promise<void> {
    await palette(page, 'Save Project');
    await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0, { timeout: STEP_TIMEOUT });
    if (requireWitness) {
        await expect
            .poll(
                async () => {
                    const snapshot = await readSnapshot(page);
                    return snapshot.mirror.witness === snapshot.witness;
                },
                { timeout: STEP_TIMEOUT }
            )
            .toBe(true);
    }
}

async function bootReload(page: Page, capabilities: string[]): Promise<void> {
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const capabilityCount = capabilities.length;
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    await expect.poll(() => capabilities.length, { timeout: 45_000 }).toBeGreaterThan(capabilityCount);
    await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: STEP_TIMEOUT });
    await expect.poll(() => page.evaluate(() => performance.timeOrigin)).toBeGreaterThan(timeOrigin);
}

async function reloadSaved(
    page: Page,
    expected: Snapshot,
    capabilities: string[],
    side: 'past' | 'future',
    types: string[],
    removeRipple = false
): Promise<void> {
    const before = await readSnapshot(page);
    const entries = requireMirror(before, side, types, removeRipple);
    await bootReload(page, capabilities);
    const restored = await expectExact(page, expected);
    expect(requireMirror(restored, side, types, removeRipple)).toEqual(entries);
    await expect(page.getByRole('button', { name: side === 'past' ? 'Undo' : 'Redo', exact: true })).toBeEnabled();
}

async function visibleTrackCount(page: Page, snapshot: Snapshot, trackName: string): Promise<void> {
    await trackRow(page, trackName).click({ position: { x: 8, y: 8 } });
    const dock = page.getByRole('button', { name: 'Toggle bottom dock', exact: true });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    await page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name: 'Editor', exact: true }).click();
    const track = snapshot.tracks.find((entry) => entry.name === trackName);
    if (!track) {
        throw new Error('The visible acceptance track is absent');
    }
    const count = page.getByTestId('selected-track-clip-count');
    await expect(count).toBeVisible();
    await expect(count).toHaveAttribute('aria-label', `${track.clips.length} clips on ${trackName}`);
    await expect(count).toHaveText(`${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}`);
}

async function evidence(page: Page, info: TestInfo, name: string, snapshot: Snapshot): Promise<void> {
    await info.attach(`${name}-state`, { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
    await info.attach(`${name}-ui`, { body: await page.screenshot(), contentType: 'image/png' });
}

async function clipPoint(page: Page, clip: Clip, ratio = 0.5): Promise<{ x: number; y: number }> {
    const track = (await readSnapshot(page)).tracks.find((entry) => entry.id === clip.trackId);
    if (!track) {
        throw new Error('Target clip owner is absent');
    }
    const row = trackRow(page, track.name);
    await row.scrollIntoViewIfNeeded();
    const header = await row.getByRole('button', { name: `Mute ${track.name}`, exact: true }).boundingBox();
    const canvas = await page.getByLabel('Timeline editor surface').boundingBox();
    const view = await page.evaluate(async () => {
        const path = '/src/modules/Arrangement/stores/index.ts';
        const { timelineViewStore }: typeof import('../../src/modules/Arrangement/stores') = await import(path);
        return timelineViewStore.value;
    });
    if (!header || !canvas || !view) {
        throw new Error('Actual timeline geometry is unavailable');
    }
    const point = {
        x: canvas.x + (clip.startBeat + (clip.endBeat - clip.startBeat) * ratio) * view.pixelsPerBeat - view.scrollX,
        y: header.y + header.height / 2,
    };
    expect(point.x).toBeGreaterThan(canvas.x + 2);
    expect(point.x).toBeLessThan(canvas.x + canvas.width - 2);
    expect(point.y).toBeGreaterThan(canvas.y);
    expect(point.y).toBeLessThan(canvas.y + canvas.height);
    return point;
}

async function addComp(page: Page, trackName: string): Promise<void> {
    const toggle = trackRow(page, trackName).getByRole('button', { name: 'Toggle variation lanes' });
    await toggle.click();
    await page.getByRole('button', { name: 'Add take', exact: true }).click();
    const promote = page.getByRole('button', { name: 'Promote Take 1 to main take', exact: true });
    await expect(promote).toBeVisible();
    const strip = promote.locator('..').getByRole('presentation');
    const box = await strip.boundingBox();
    if (!box) {
        throw new Error('Actual take comp strip is unavailable');
    }
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 3) / 4, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByText('1 take · 1 comp region', { exact: true })).toBeVisible();
    await toggle.click();
}

async function addAutomation(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const arrangementPath = '/src/modules/Arrangement/stores/index.ts';
        const automationPath = '/src/modules/Automation/stores/index.ts';
        const commandPath = '/src/modules/Command/useCases/index.ts';
        const { trackStore }: typeof import('../../src/modules/Arrangement/stores') = await import(arrangementPath);
        const { automationStore }: typeof import('../../src/modules/Automation/stores') = await import(automationPath);
        const { executeAppAction }: typeof import('../../src/modules/Command/useCases') = await import(commandPath);
        for (const track of trackStore.value?.tracks ?? []) {
            if (track.clips.length === 0) {
                continue;
            }
            const action: AppAction = {
                type: 'addAutomationLane',
                payload: { trackId: track.id, parameterId: 'gain', parameterName: 'Acceptance gain' },
            };
            await executeAppAction(action);
            const lane = automationStore.value?.lanes.find(
                (entry) => entry.trackId === track.id && entry.parameterId === 'gain'
            );
            if (!lane) {
                throw new Error('Registered addAutomationLane produced no lane');
            }
            for (const [beat, value] of [
                [0, 0.4],
                [3, 0.8],
                [7, 0.6],
            ]) {
                await executeAppAction({
                    type: 'addAutomationPoint',
                    payload: { laneId: lane.id, beat, value, curve: 'linear', tension: 0 },
                });
            }
        }
    });
}

async function replayTwice(
    page: Page,
    info: TestInfo,
    name: string,
    trackName: string,
    types: string[],
    capabilities: string[],
    edit: (before: Snapshot) => Promise<void>,
    removeRipple = false
): Promise<void> {
    const before = await readSnapshot(page);
    await visibleTrackCount(page, before, trackName);
    await evidence(page, info, `${name}-before`, before);
    await edit(before);
    await expect
        .poll(async () => {
            const state = await readSnapshot(page);
            return state.mirror.past
                .slice(-types.length)
                .map((entry) => entry.action?.type)
                .sort();
        })
        .toEqual([...types].sort());
    const changed = await readSnapshot(page);
    expect(changed.exact).not.toEqual(before.exact);
    expect(changed.inspection).toMatchObject({ projectInvariantsValid: true, audioGraphValid: true });
    await visibleTrackCount(page, changed, trackName);
    await evidence(page, info, `${name}-changed`, changed);
    await save(page);
    await reloadSaved(page, changed, capabilities, 'past', types, removeRipple);
    await visibleTrackCount(page, changed, trackName);
    for (let cycle = 1; cycle <= 2; cycle += 1) {
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        const undone = await expectExact(page, before);
        await visibleTrackCount(page, undone, trackName);
        await evidence(page, info, `${name}-undo-${cycle}`, undone);
        await save(page);
        await reloadSaved(page, before, capabilities, 'future', types, removeRipple);
        await visibleTrackCount(page, before, trackName);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        const redone = await expectExact(page, changed);
        await visibleTrackCount(page, redone, trackName);
        await evidence(page, info, `${name}-redo-${cycle}`, redone);
    }
}

test('persisted clip edits replay exact owners and source material through real same-tab hydration', async ({
    page,
}, info) => {
    test.setTimeout(480_000);
    const capabilities: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('[capabilities]')) {
            capabilities.push(message.text());
        }
    });
    await enable_direct_e2e_viewport(page);
    await page.addInitScript((dismissed: string) => {
        localStorage.setItem('wd:onboarding-completed', '1');
        localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        localStorage.setItem('wd:first-load-hint-shown', '1');
    }, stringify(true));
    const response = await page.goto('/');
    expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    await expect.poll(() => capabilities.length, { timeout: 45_000 }).toBeGreaterThan(0);
    await launch_new_project(page);
    await palette(page, 'Add Audio Track');
    await expect(trackRow(page, 'Audio')).toBeVisible();
    await importIntoTrack(page, 'Audio', 'Audio');
    await expect
        .poll(
            async () =>
                (await readSnapshot(page)).tracks
                    .flatMap((track) => track.clips)
                    .filter((clip) => clip.type === 'audio').length
        )
        .toBe(1);
    await importIntoTrack(page, 'Audio', 'MIDI');
    await expect(trackRow(page, MIDI_NAME)).toBeVisible();
    await addComp(page, 'Audio');
    await addComp(page, MIDI_NAME);
    await addAutomation(page);
    const seed = await readSnapshot(page);
    expect(seed.counts).toEqual({ notes: 1, controllers: 3, takes: 2, compRegions: 2, automationPoints: 6 });
    // A real boot binds this newly created project's initially unowned setup history.
    await save(page, false);
    await bootReload(page, capabilities);
    const canonicalSeed = structuredClone(seed);
    const initialExact = canonicalSeed.exact as {
        raw: { midi: Record<string, unknown> };
        projected: { midi: Record<string, unknown> };
    };
    const initialFormats = {
        raw: initialExact.raw.midi.noteCoordinateFormat,
        projected: initialExact.projected.midi.noteCoordinateFormat,
    };
    expect(initialFormats.raw).toBe(initialFormats.projected);
    if (initialFormats.raw === undefined) {
        expect(initialFormats).toEqual({ raw: undefined, projected: undefined });
    } else {
        expect(initialFormats).toEqual({ raw: 'clip-relative', projected: 'clip-relative' });
    }
    await info.attach('initial-midi-coordinate-format', {
        body: JSON.stringify({ seedFormat: initialFormats.raw ?? 'unstamped', hydratedFormat: 'clip-relative' }),
        contentType: 'application/json',
    });
    // The production load migration stamps an unstamped store even when no notes move.
    // This initial comparison permits that literal addition; every payload field stays exact.
    initialExact.raw.midi = { ...initialExact.raw.midi, noteCoordinateFormat: 'clip-relative' };
    initialExact.projected.midi = { ...initialExact.projected.midi, noteCoordinateFormat: 'clip-relative' };
    const hydratedSeed = await expectExact(page, canonicalSeed);
    expect(hydratedSeed.mirror.projectId).toBe(seed.projectId);
    expect(hydratedSeed.mirror.witness).toBe(hydratedSeed.witness);

    await test.step('Delete Time through the visible loop-region command', async () => {
        await replayTwice(page, info, 'delete-time', MIDI_NAME, ['deleteTime'], capabilities, async () => {
            const ruler = await page.getByLabel('Beat ruler').boundingBox();
            const view = await page.evaluate(async () => {
                const path = '/src/modules/Arrangement/stores/index.ts';
                const { timelineViewStore }: typeof import('../../src/modules/Arrangement/stores') = await import(path);
                return timelineViewStore.value;
            });
            if (!ruler || !view) {
                throw new Error('Visible beat ruler geometry is unavailable');
            }
            await page.keyboard.down('Shift');
            await page.mouse.move(ruler.x + 2 * view.pixelsPerBeat - view.scrollX, ruler.y + ruler.height / 2);
            await page.mouse.down();
            await page.mouse.move(ruler.x + 4 * view.pixelsPerBeat - view.scrollX, ruler.y + ruler.height / 2, {
                steps: 4,
            });
            await page.mouse.up();
            await page.keyboard.up('Shift');
            await palette(page, 'Delete Time (Loop Region)');
            await expect(page.getByTestId('selected-track-clip-count')).toHaveText('2 clips');
        });
    });

    await test.step('Split a sustained MIDI note through its visible clip menu', async () => {
        await replayTwice(page, info, 'split', MIDI_NAME, ['splitClip'], capabilities, async (before) => {
            const allClips = before.tracks.flatMap((track) => track.clips);
            const midiClips = allClips.filter((entry) => entry.type === 'midi');
            const clip = midiClips.sort((a, b) => b.endBeat - b.startBeat - (a.endBeat - a.startBeat))[0];
            if (!clip) {
                throw new Error('Imported MIDI clip is absent');
            }
            const point = await clipPoint(page, clip);
            await page.mouse.click(point.x, point.y, { button: 'right' });
            await page.getByRole('menuitem', { name: 'Split at Cursor', exact: true }).click();
            const originalCount = before.tracks.find((track) => track.id === clip.trackId)?.clips.length;
            expect(originalCount).toBeDefined();
            await expect(page.getByTestId('selected-track-clip-count')).toHaveText(`${originalCount! + 1} clips`);
            await expect.poll(async () => (await readSnapshot(page)).counts.notes).toBe(before.counts.notes + 1);
        });
    });

    await test.step('Move one MIDI clip through an actual timeline drag', async () => {
        await replayTwice(page, info, 'move', MIDI_NAME, ['moveClip'], capabilities, async (before) => {
            const clip = before.tracks.flatMap((track) => track.clips).find((entry) => entry.type === 'midi');
            if (!clip) {
                throw new Error('MIDI move target is absent');
            }
            const point = await clipPoint(page, clip);
            await page.mouse.click(point.x, point.y);
            const start = page.getByTestId('selected-clip-start-beat');
            await expect(start).toHaveAttribute('aria-label', `Selected clip starts at beat ${clip.startBeat}`);
            await page.mouse.move(point.x, point.y);
            await page.mouse.down();
            await page.mouse.move(point.x + 96, point.y, { steps: 8 });
            await page.mouse.up();
            await expect(start).not.toHaveAttribute('aria-label', `Selected clip starts at beat ${clip.startBeat}`);
        });
    });

    await test.step('Remove one selected MIDI clip with Backspace', async () => {
        await replayTwice(page, info, 'remove', MIDI_NAME, ['removeClip'], capabilities, async (before) => {
            await expect(page.getByTestId('tool-ripple')).not.toHaveAttribute('aria-pressed', 'true');
            const allClips = before.tracks.flatMap((track) => track.clips);
            const midiClips = allClips.filter((entry) => entry.type === 'midi');
            const clip = midiClips.sort((a, b) => a.startBeat - b.startBeat)[0];
            if (!clip) {
                throw new Error('MIDI removal target is absent');
            }
            const point = await clipPoint(page, clip);
            await page.mouse.click(point.x, point.y);
            await page.keyboard.press('Backspace');
            const remaining = (before.tracks.find((track) => track.id === clip.trackId)?.clips.length ?? 0) - 1;
            await expect(page.getByTestId('selected-track-clip-count')).toHaveText(
                `${remaining} clip${remaining === 1 ? '' : 's'}`
            );
        });
    });

    await test.step('Registered grouped ripple removal then split retains its ordered prefix', async () => {
        const ripple = page.getByTestId('tool-ripple');
        await expect(ripple).not.toHaveAttribute('aria-pressed', 'true');
        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'true');
        await replayTwice(
            page,
            info,
            'grouped-ripple',
            'Audio',
            ['removeClip', 'splitClip'],
            capabilities,
            async (before) => {
                const track = before.tracks.find(
                    (entry) => entry.clips.filter((clip) => clip.type === 'audio').length === 2
                );
                const clips = track?.clips
                    .filter((clip) => clip.type === 'audio')
                    .sort((a, b) => a.startBeat - b.startBeat);
                if (!clips || clips.length !== 2) {
                    throw new Error('Delete Time did not leave the two actual audio fragments required by this group');
                }
                const [first, second] = clips;
                if (!first || !second) {
                    throw new Error('Audio fragment identities are absent');
                }
                expect(first.endBeat).toBe(second.startBeat);
                const beat =
                    second.startBeat - (first.endBeat - first.startBeat) + (second.endBeat - second.startBeat) / 2;
                // The grouped-history contract uses sequential forward commits.
                // Atomic forward admission is separately tracked by #5439.
                const commits = await page.evaluate(
                    async ({ firstId, secondId, beat }) => {
                        const path = '/src/modules/Command/useCases/index.ts';
                        const { executeAppAction }: typeof import('../../src/modules/Command/useCases') = await import(
                            path
                        );
                        const batch: AppAction[] = [
                            { type: 'removeClip', payload: { clipId: firstId } },
                            { type: 'splitClip', payload: { clipId: secondId, beat } },
                        ];
                        const groupId = `acceptance-${crypto.randomUUID()}`;
                        const committed: string[] = [];
                        for (const action of batch) {
                            const priorCount = committed.length;
                            await executeAppAction(action, {
                                source: 'manual',
                                groupId,
                                groupLabel: 'Acceptance ripple remove then split',
                                onCommitted: () => committed.push(action.type),
                            });
                            if (committed.length !== priorCount + 1) {
                                throw new Error(`Expected exactly one real commit callback for ${action.type}`);
                            }
                        }
                        return committed;
                    },
                    { firstId: first.id, secondId: second.id, beat }
                );
                expect(commits).toEqual(['removeClip', 'splitClip']);
                await info.attach('grouped-forward-commits', {
                    body: JSON.stringify(commits),
                    contentType: 'application/json',
                });
            },
            true
        );
    });
    const finalState = await readSnapshot(page);
    await save(page);
    await reloadSaved(page, finalState, capabilities, 'past', ['removeClip', 'splitClip'], true);
    await evidence(page, info, 'final-hydrated', await readSnapshot(page));
});
