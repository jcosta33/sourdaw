import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Page } from '@playwright/test';

import { buildSineWav } from './audioClipFixture';
import { chooseProjectDirectory } from './chosenProjectDirectory';
import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const STEP_TIMEOUT = 30_000;
const CHILDREN = ['addTrack', 'addClip', 'addNotes'];
test.use({ actionTimeout: STEP_TIMEOUT, navigationTimeout: STEP_TIMEOUT });

type Clip = { id: string; trackId: string; type: string; audioBufferId?: string; startBeat: number; endBeat: number };
type Track = { id: string; kind: string; name: string; clips: Clip[] };
type Entry = {
    id: string;
    kind: string;
    groupId?: string;
    action?: { type: string };
    inverseAction?: { type: string };
};
type Snapshot = {
    projectId: string;
    name: string;
    witness: string;
    exact: { raw: { tracks: unknown; midi: unknown }; projected: { tracks: unknown; midi: unknown } };
    tracks: Track[];
    notes: Record<string, unknown[]>;
    pcm: { bufferId: string; frames: number; sampleRate: number; channels: string[] }[];
    past: Entry[];
    future: Entry[];
    history: { actionKind: string; groupId?: string }[];
    mirror: { projectId?: string; witness?: string; past: Entry[]; future: Entry[] };
};

function onsetWav(): Buffer {
    const wav = buildSineWav(2);
    for (let frame = 0; frame < 88_200; frame += 1) {
        const seconds = frame / 44_100;
        if (!(seconds >= 0.25 && seconds < 0.45) && !(seconds >= 1.1 && seconds < 1.3)) {
            wav.writeInt16LE(0, 44 + frame * 2);
        }
    }
    return wav;
}

async function palette(page: Page, name: string): Promise<void> {
    await page.keyboard.press(`${MOD}+K`);
    await page.getByTestId('command-palette-input').fill(name);
    const option = page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByTestId('command-palette-input')).toHaveCount(0);
}

async function capture(page: Page): Promise<Snapshot> {
    const serialized = await page.evaluate(async () => {
        const [
            { trackStore },
            { midiStore },
            { projectStore },
            crdt,
            { getCachedAudioBuffer },
            { captureUndoHistory },
        ] = await Promise.all([
            import('/src/modules/Arrangement/stores/index.ts'),
            import('/src/modules/MIDI/stores/index.ts'),
            import('/src/modules/Project/stores/index.ts'),
            import('/src/modules/CrdtDocument/useCases/index.ts'),
            import('/src/modules/AudioEngine/useCases/index.ts'),
            import('/src/modules/Command/useCases/index.ts'),
        ]);
        const document = crdt.getCrdtDoc<{
            tracks: NonNullable<typeof trackStore.value>;
            midi: NonNullable<typeof midiStore.value>;
            actionHistory?: { entries: { actionKind: string; groupId?: string }[] };
        }>('root');
        const project = projectStore.value;
        if (!document || !trackStore.value || !midiStore.value || !project?.initialized || project.loading) {
            throw new Error('The live project has not hydrated');
        }
        const witness = crdt.captureDurableDocumentWitness();
        const tracks = trackStore.value.tracks;
        const pcm = [];
        for (const bufferId of [
            ...new Set(
                tracks
                    .flatMap((track) => track.clips)
                    .flatMap((clip) => (clip.audioBufferId ? [clip.audioBufferId] : []))
            ),
        ]) {
            const buffer = getCachedAudioBuffer({ bufferId });
            if (!buffer) throw new Error(`Source PCM missing: ${bufferId}`);
            const channels = [];
            for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
                const data = buffer.getChannelData(channel).slice();
                const digest = await crypto.subtle.digest('SHA-256', data.buffer);
                channels.push(
                    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
                );
            }
            pcm.push({ bufferId, frames: buffer.length, sampleRate: buffer.sampleRate, channels });
        }
        if (crdt.captureDurableDocumentWitness() !== witness) throw new Error('Project changed while reading evidence');
        const history = captureUndoHistory();
        return JSON.stringify({
            projectId: project.projectId,
            name: project.name,
            witness,
            tracks,
            notes: midiStore.value.notesByClipId,
            pcm,
            exact: {
                raw: { tracks: document.tracks.tracks, midi: document.midi },
                projected: { tracks, midi: midiStore.value },
            },
            past: history.past,
            future: history.future,
            history: document.actionHistory?.entries ?? [],
            mirror: JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}'),
        });
    });
    return JSON.parse(serialized) as Snapshot;
}

async function sourcePoint(page: Page, snapshot: Snapshot): Promise<{ x: number; y: number }> {
    const track = snapshot.tracks.find((entry) => entry.clips.some((clip) => clip.type === 'audio'));
    const clip = track?.clips.find((entry) => entry.type === 'audio');
    if (!track || !clip) throw new Error('Imported audio source is absent');
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .locator('[role="row"][draggable="true"]')
        .filter({ has: page.getByRole('button', { name: `Mute ${track.name}`, exact: true }) });
    await row.scrollIntoViewIfNeeded();
    const header = await row.getByRole('button', { name: `Mute ${track.name}`, exact: true }).boundingBox();
    const canvas = await page.getByLabel('Timeline editor surface').boundingBox();
    const view = await page.evaluate(
        async () => (await import('/src/modules/Arrangement/stores/index.ts')).timelineViewStore.value
    );
    if (!header || !canvas || !view) throw new Error('Live timeline geometry is unavailable');
    const point = {
        x: canvas.x + (clip.startBeat + (clip.endBeat - clip.startBeat) / 2) * view.pixelsPerBeat - view.scrollX,
        y: header.y + header.height / 2,
    };
    expect(point.x).toBeGreaterThan(canvas.x);
    expect(point.x).toBeLessThan(canvas.x + canvas.width);
    expect(point.y).toBeGreaterThan(canvas.y);
    expect(point.y).toBeLessThan(canvas.y + canvas.height);
    return point;
}

async function save(page: Page): Promise<void> {
    await chooseProjectDirectory(page);
    await palette(page, 'Save Project');
    await expect(page.getByTitle('Unsaved changes')).toHaveCount(0, { timeout: STEP_TIMEOUT });
}

async function reloadSaved(page: Page, expected: Pick<Snapshot, 'projectId' | 'name'>): Promise<void> {
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    const mode = () =>
        page.evaluate(async (projectId) => {
            const { projectStore } = await import('/src/modules/Project/stores/index.ts');
            const project = projectStore.value;
            if (!project || project.loading) return 'pending';
            if (project.initialized) return project.projectId === projectId ? 'saved-active' : 'wrong-active';
            return 'launch-ready';
        }, expected.projectId);
    await expect.poll(mode, { timeout: STEP_TIMEOUT }).toMatch(/^(saved-active|launch-ready)$/);
    if ((await mode()) === 'launch-ready') {
        await page.getByRole('button', { name: `Open recent project ${expected.name}`, exact: true }).click();
    }
    await expect.poll(mode, { timeout: STEP_TIMEOUT }).toBe('saved-active');
    await wait_for_workspace_ready(page);
    await expect.poll(() => page.evaluate(() => performance.timeOrigin)).toBeGreaterThan(timeOrigin);
    await expect.poll(async () => (await capture(page)).projectId).toBe(expected.projectId);
}

function requireGroup(snapshot: Snapshot, side: 'past' | 'future'): Entry[] {
    const entries = side === 'past' ? snapshot.past.slice(-CHILDREN.length) : snapshot.future.slice(0, CHILDREN.length);
    expect(entries.map((entry) => entry.action?.type)).toEqual(CHILDREN);
    expect(entries.every((entry) => entry.kind === 'action' && entry.inverseAction?.type)).toBe(true);
    expect(entries[0]?.groupId).toBeTruthy();
    expect(new Set(entries.map((entry) => entry.groupId)).size).toBe(1);
    return entries;
}

async function expectExact(page: Page, expected: Snapshot): Promise<Snapshot> {
    await expect.poll(async () => (await capture(page)).exact).toEqual(expected.exact);
    const actual = await capture(page);
    expect(actual.exact.raw).toEqual(actual.exact.projected);
    expect(actual.pcm).toEqual(expected.pcm);
    return actual;
}

for (const route of ['inspector', 'waveform', 'context-menu'] as const) {
    test(`${route} commits real PCM conversion with grouped replay and saved future hydration`, async ({
        page,
    }, info) => {
        test.setTimeout(180_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });
        await setupWorkspace(page, { clearLocalStorage: false });
        await launch_new_project(page);
        await palette(page, 'Add Audio Track');
        await page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .first()
            .click({ button: 'right' });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('menuitem', { name: /Import Audio/i }).click();
        await (await chooser).setFiles({ name: 'onset-source.wav', mimeType: 'audio/wav', buffer: onsetWav() });
        await expect
            .poll(
                async () =>
                    (await capture(page)).tracks.flatMap((track) => track.clips).filter((clip) => clip.type === 'audio')
                        .length
            )
            .toBe(1);
        await save(page);
        const imported = await capture(page);
        await reloadSaved(page, imported);
        const before = await capture(page);
        expect(before.exact.raw).toEqual(before.exact.projected);
        expect(before.pcm).toEqual(imported.pcm);
        expect(before.pcm).toHaveLength(1);
        expect(before.pcm[0]).toMatchObject({ frames: 96_000, sampleRate: 48_000 });
        const point = await sourcePoint(page, before);
        await page.mouse.click(point.x, point.y);
        if (route === 'inspector') {
            const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
            await expect(inspector.getByRole('button', { name: 'MIDI (Basic)', exact: true })).toBeVisible();
            await inspector.getByRole('button', { name: 'MIDI (Basic)', exact: true }).click();
        } else if (route === 'waveform') {
            const dock = page.getByTestId('toggle-bottom-dock');
            if ((await dock.getAttribute('aria-pressed')) !== 'true') await dock.click();
            await page
                .getByRole('tablist', { name: 'Bottom dock' })
                .getByRole('tab', { name: 'Editor', exact: true })
                .click();
            await expect(page.getByLabel('Waveform editor', { exact: true })).toBeVisible();
            await page.getByLabel('Waveform editor', { exact: true }).click({ button: 'right' });
            await page.getByRole('menuitem', { name: /AI Audio → MIDI/ }).click();
        } else {
            await page.mouse.click(point.x, point.y, { button: 'right' });
            await page
                .getByRole('menuitem')
                .filter({ has: page.getByText('Convert to MIDI', { exact: true }) })
                .click();
        }
        await expect
            .poll(async () => (await capture(page)).tracks.filter((track) => track.kind === 'midi').length)
            .toBe(1);
        const created = await capture(page);
        const output = created.tracks.find((track) => track.kind === 'midi');
        expect(output?.clips).toHaveLength(1);
        expect(created.notes[output!.clips[0]!.id]!.length).toBeGreaterThan(0);
        expect(created.exact.raw).toEqual(created.exact.projected);
        expect(created.pcm).toEqual(before.pcm);
        const group = requireGroup(created, 'past');
        expect(created.history.slice(-CHILDREN.length).map((entry) => entry.actionKind)).toEqual(CHILDREN);
        expect(created.history.slice(-CHILDREN.length).every((entry) => entry.groupId === group[0]!.groupId)).toBe(
            true
        );
        await info.attach(`${route}-created`, {
            body: JSON.stringify({ before, created }, null, 2),
            contentType: 'application/json',
        });
        for (let cycle = 0; cycle < 2; cycle += 1) {
            await page.getByTestId('transport-undo').click();
            await expectExact(page, before);
            await page.getByTestId('transport-redo').click();
            await expectExact(page, created);
        }
        await save(page);
        await reloadSaved(page, created);
        await expectExact(page, created);
        await page.getByTestId('transport-undo').click();
        await expectExact(page, before);
        await save(page);
        await expect
            .poll(async () => {
                const snapshot = await capture(page);
                return {
                    group: snapshot.mirror.future.slice(0, CHILDREN.length).map((entry) => entry.action?.type),
                    witnessMatches: snapshot.mirror.witness === snapshot.witness,
                    projectId: snapshot.mirror.projectId,
                };
            })
            .toEqual({ group: CHILDREN, witnessMatches: true, projectId: before.projectId });
        const future = requireGroup(await capture(page), 'future');
        await reloadSaved(page, before);
        const hydrated = await expectExact(page, before);
        expect(requireGroup(hydrated, 'future')).toEqual(future);
        await page.getByTestId('transport-redo').click();
        await expectExact(page, created);
        await page.getByTestId('transport-undo').click();
        const final = await expectExact(page, before);
        await info.attach(`${route}-committed-and-replayed`, {
            body: JSON.stringify({ before, created, hydrated, final }, null, 2),
            contentType: 'application/json',
        });
        expect(errors).toEqual([]);
    });
}
