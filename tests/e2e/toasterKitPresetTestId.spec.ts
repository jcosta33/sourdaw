import { env } from 'node:process';

import { type Page } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { chooseProjectDirectory } from './chosenProjectDirectory';
import { expect, test } from './e2eTest';
import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

const ENTRY = isBuiltE2eShardRun(env) ? '/e2e/persisted-hydration.js' : '/tests/e2e/persistedHydrationEntry.ts';

async function readToasterProject(page: Page, selection: { trackId?: string; excludeTrackId?: string } = {}) {
    return page.evaluate(
        async ({ entryPath, trackId, excludeTrackId }) => {
            const { arrangement, automation, command, crdt, project }: typeof import('./persistedHydrationEntry') =
                await import(entryPath);
            type Tracks = NonNullable<typeof arrangement.trackStore.value>;
            const root = crdt.getCrdtDoc<{ tracks: Tracks }>('root');
            const projected = arrangement.trackStore.value;
            const track = projected?.tracks.find(
                (candidate) =>
                    (trackId === undefined ? candidate.id !== excludeTrackId : candidate.id === trackId) &&
                    candidate.devices.some((device) => device.type === 'toaster')
            );
            const device = track?.devices.find((candidate) => candidate.type === 'toaster');
            const raw = root?.tracks.tracks
                .find((candidate) => candidate.id === track?.id)
                ?.devices.find((candidate) => candidate.id === device?.id);
            const projectId = project.projectStore.value?.projectId;
            if (!root || !track || !device || !raw || !projectId || project.projectStore.value?.loading) {
                return null;
            }
            const history = command.captureUndoHistory();
            const latest = history.past.at(-1);
            return {
                projectId,
                trackId: track.id,
                trackName: track.name,
                deviceId: device.id,
                projectedHasChunk: Object.hasOwn(device, 'deviceState'),
                rawHasChunk: Object.hasOwn(raw, 'deviceState'),
                projected: device,
                raw,
                otherRows: root.tracks.tracks.filter((candidate) => candidate.id !== track.id),
                automation: automation.automationStore.value ?? null,
                history: {
                    count: history.past.length,
                    latestType: latest?.kind === 'action' ? latest.action.type : null,
                    latestGroupId: latest?.groupId,
                },
            };
        },
        { entryPath: ENTRY, ...selection }
    );
}

async function requireToasterProject(page: Page, selection?: { trackId?: string; excludeTrackId?: string }) {
    const snapshot = await readToasterProject(page, selection);
    if (!snapshot) {
        throw new Error('The installed Toaster must exist in both project views');
    }
    return snapshot;
}

declare global {
    var toasterAudioProbe: { node: AudioNode; worklet: AudioNode; analyser: AnalyserNode } | undefined;
}

async function readToasterRuntime(page: Page, deviceId: string) {
    return page.evaluate(
        async ({ entryPath, deviceId }) => {
            const { arrangement, toaster }: typeof import('./persistedHydrationEntry') = await import(entryPath);
            const state = toaster.toasterStore.value?.[deviceId];
            if (!state) throw new Error('Mounted Toaster state is unavailable');
            return { state, selectedTrackId: arrangement.trackStore.value?.selectedTrackId };
        },
        { entryPath: ENTRY, deviceId }
    );
}

async function sampleToasterAudio(page: Page, trackId: string, deviceId: string) {
    return page.evaluate(
        async ({ entryPath, trackId, deviceId }) => {
            const { audio }: typeof import('./persistedHydrationEntry') = await import(entryPath);
            const device = audio
                .getTrackStrip(trackId)
                ?.deviceNodes.find((candidate) => candidate.deviceId === deviceId);
            if (!device?.toasterControls?.ready) throw new Error('Toaster worklet is not ready');
            const worklet = device.nodes.find((node) => node instanceof AudioWorkletNode);
            if (!worklet) throw new Error('Mounted Toaster worklet is unavailable');
            if (!window.toasterAudioProbe) {
                const analyser = device.outputNode.context.createAnalyser();
                analyser.fftSize = 2048;
                device.outputNode.connect(analyser);
                window.toasterAudioProbe = { node: device.outputNode, worklet, analyser };
            }
            const probe = window.toasterAudioProbe;
            if (probe.node !== device.outputNode || probe.worklet !== worklet) {
                throw new Error('The mounted Toaster runtime changed');
            }
            const context = device.outputNode.context;
            if (!(context instanceof AudioContext)) throw new Error('Toaster is not using a live AudioContext');
            if (context.state !== 'running') await context.resume();
            const settled = context.currentTime + 0.25;
            while (context.currentTime < settled) await new Promise(requestAnimationFrame);
            device.toasterControls.noteOn(1, 1);
            const samples = new Float32Array(probe.analyser.fftSize);
            const end = context.currentTime + 0.5;
            let peak = 0;
            while (context.currentTime < end) {
                await new Promise(requestAnimationFrame);
                probe.analyser.getFloatTimeDomainData(samples);
                for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
            }
            device.toasterControls.noteOff(1);
            return peak;
        },
        { entryPath: ENTRY, trackId, deviceId }
    );
}

test.describe('Toaster kit shelf and sequencer', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('loading Sourdough 808 selects that kit and remaps Closed HH to CH', async ({ page }) => {
        const closedHh = page.getByRole('button', { name: 'Trigger Closed HH', exact: true });
        const ch = page.getByRole('button', { name: 'Trigger CH', exact: true });
        const load808 = page.getByRole('button', { name: 'Load kit Sourdough 808', exact: true });

        await expect(closedHh).toBeVisible();
        await expect(ch).toHaveCount(0);
        await expect(load808).toHaveAttribute('aria-pressed', 'false');

        await load808.click();

        await expect(load808).toHaveAttribute('aria-pressed', 'true');
        await expect(ch).toBeVisible();
        await expect(closedHh).toHaveCount(0);
    });

    test('Kick step 1 toggles on and Close dismisses Toaster', async ({ page }) => {
        const view = page.getByRole('combobox', { name: 'Toaster view', exact: true });
        await expect(view).toBeVisible();
        await expect(view).toHaveValue('simple');
        await view.selectOption('full');
        await expect(view).toHaveValue('full');

        const off = page.getByRole('checkbox', { name: 'Kick step 1, off', exact: true });
        await expect(off).toHaveAttribute('aria-checked', 'false');

        await off.click();
        await expect(page.getByRole('checkbox', { name: /Kick step 1, on/ })).toHaveAttribute('aria-checked', 'true');

        const close = page.getByRole('button', { name: 'Close Toaster', exact: true });
        await close.click();
        await expect(close).toHaveCount(0);
    });

    test('Master drag and keyboard edits replay and persist on the mounted Toaster', async ({ page }) => {
        const first = await requireToasterProject(page);
        await page.getByRole('button', { name: 'Close Toaster', exact: true }).click();
        await open_browser_instrument({ page, instrument: 'Toaster' });
        const second = await requireToasterProject(page, { excludeTrackId: first.trackId });
        const selection = { trackId: second.trackId };
        const readTarget = () => readToasterProject(page, selection);
        const view = page.getByRole('combobox', { name: 'Toaster view', exact: true });
        await view.selectOption('full');
        const snare = page.getByRole('button', { name: 'Trigger Snare', exact: true });
        await snare.click();
        await expect(snare).toHaveAttribute('aria-pressed', 'true');
        await expect
            .poll(async () =>
                page.evaluate(
                    async ({ entryPath, trackId, deviceId }) => {
                        const { audio }: typeof import('./persistedHydrationEntry') = await import(entryPath);
                        return (
                            audio.getTrackStrip(trackId)?.deviceNodes.find((device) => device.deviceId === deviceId)
                                ?.toasterControls?.ready === true
                        );
                    },
                    { entryPath: ENTRY, trackId: second.trackId, deviceId: second.deviceId }
                )
            )
            .toBe(true);
        await page.evaluate(
            async ({ entryPath, trackId, deviceId }) => {
                const { audio }: typeof import('./persistedHydrationEntry') = await import(entryPath);
                const device = audio
                    .getTrackStrip(trackId)
                    ?.deviceNodes.find((candidate) => candidate.deviceId === deviceId);
                const context = device?.outputNode.context;
                if (!(context instanceof AudioContext)) throw new Error('Toaster is not using a live AudioContext');
                await context.resume();
            },
            { entryPath: ENTRY, trackId: second.trackId, deviceId: second.deviceId }
        );
        const transport = page.locator('section').filter({ has: page.getByText('Transport', { exact: true }) });
        await transport.getByRole('button', { name: 'Play', exact: true }).click();
        const stop = transport.getByRole('button', { name: 'Stop', exact: true });
        await expect(stop).toBeVisible();
        const cursor = page.getByText('Playback cursor', { exact: true }).locator('xpath=..');
        const readStep = async () => Number((await cursor.innerText()).match(/Step\s+(\d+)/i)?.[1]);
        await expect.poll(readStep).toBeGreaterThan(1);
        const before = await requireToasterProject(page, selection);
        const runtimeBefore = await readToasterRuntime(page, second.deviceId);
        expect(runtimeBefore.state.isPlaying).toBe(true);
        expect(runtimeBefore.state.selectedPadIndex).toBe(1);
        expect(before.rawHasChunk).toBe(false);
        expect(before.projectedHasChunk).toBe(false);
        const master = page.getByRole('slider', { name: 'Master', exact: true });
        await master.scrollIntoViewIfNeeded();
        await expect(master).toHaveAttribute('aria-valuenow', '1');
        expect(await sampleToasterAudio(page, second.trackId, second.deviceId)).toBeGreaterThan(0.0001);
        const box = await master.boundingBox();
        if (!box) throw new Error('Master knob has no bounds');
        let x = box.x + box.width / 2;
        let y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 75);
        await expect(master).toHaveAttribute('aria-valuenow', '0');
        expect(await sampleToasterAudio(page, second.trackId, second.deviceId)).toBeLessThan(0.00001);
        expect(await readTarget()).toEqual(before);
        await page.mouse.move(x, y);
        await expect(master).toHaveAttribute('aria-valuenow', '1');
        await page.mouse.up();
        await expect.poll(readTarget).toEqual(before);
        expect(await sampleToasterAudio(page, second.trackId, second.deviceId)).toBeGreaterThan(0.0001);
        const stepBeforePreview = await readStep();
        await snare.click();
        expect(await readTarget()).toEqual(before);
        await expect.poll(readStep).not.toBe(stepBeforePreview);
        await expect(stop).toHaveAttribute('aria-pressed', 'true');
        await master.scrollIntoViewIfNeeded();
        const newBox = await master.boundingBox();
        if (!newBox) throw new Error('Master knob has no bounds after preview');
        x = newBox.x + newBox.width / 2;
        y = newBox.y + newBox.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        const values: number[] = [];
        const samples = [];
        for (const delta of [15, 30, 45]) {
            await page.mouse.move(x, y - delta);
            await expect
                .poll(async () => Number(await master.getAttribute('aria-valuenow')))
                .toBeGreaterThan(values.at(-1) ?? 1);
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
            values.push(Number(await master.getAttribute('aria-valuenow')));
            samples.push(await requireToasterProject(page, selection));
        }
        await page.mouse.up();
        await expect.poll(async () => (await readTarget())?.history.count).toBe(before.history.count + 1);
        const committed = await requireToasterProject(page, selection);
        expect(samples).toEqual([before, before, before]);
        expect(committed.history.latestType).toBe('setToasterMasterGain');
        expect(committed.otherRows).toEqual(before.otherRows);
        expect(committed.automation).toEqual(before.automation);
        const runtimeCommitted = await readToasterRuntime(page, second.deviceId);
        const { masterGain: originalGain, ...originalKit } = runtimeBefore.state.kit;
        const { masterGain: committedGain, ...committedKit } = runtimeCommitted.state.kit;
        expect(originalGain).toBe(1);
        expect(committedGain).toBe(values.at(-1));
        expect(committedKit).toEqual(originalKit);
        expect(runtimeCommitted.state.selectedPadIndex).toBe(runtimeBefore.state.selectedPadIndex);
        expect(runtimeCommitted.state.isPlaying).toBe(true);
        expect(runtimeCommitted.selectedTrackId).toBe(runtimeBefore.selectedTrackId);
        await expect(snare).toHaveAttribute('aria-pressed', 'true');
        await expect(stop).toHaveAttribute('aria-pressed', 'true');
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        await undo.click();
        await expect.poll(readTarget).toEqual(before);
        await expect(master).toHaveAttribute('aria-valuenow', '1');
        await redo.click();
        await expect.poll(readTarget).toEqual(committed);
        await expect(master).toHaveAttribute('aria-valuenow', String(values.at(-1)));
        await master.press('ArrowUp');
        await expect.poll(async () => (await readTarget())?.history.count).toBe(before.history.count + 2);
        const keyboard = await requireToasterProject(page, selection);
        expect(keyboard.history.latestType).toBe('setToasterMasterGain');
        await undo.click();
        await expect.poll(readTarget).toEqual(committed);
        await redo.click();
        await expect.poll(readTarget).toEqual(keyboard);
        await expect(snare).toHaveAttribute('aria-pressed', 'true');
        await expect(stop).toHaveAttribute('aria-pressed', 'true');
        await stop.click();
        expect(await sampleToasterAudio(page, second.trackId, second.deviceId)).toBeGreaterThan(0.0001);
        await master.press('Home');
        await expect(master).toHaveAttribute('aria-valuenow', '0');
        await expect.poll(async () => (await readTarget())?.history.count).toBe(before.history.count + 3);
        expect(await sampleToasterAudio(page, second.trackId, second.deviceId)).toBeLessThan(0.00001);
        await undo.click();
        await expect.poll(readTarget).toEqual(keyboard);
        expect(await sampleToasterAudio(page, second.trackId, second.deviceId)).toBeGreaterThan(0.0001);
        expect(await readTarget()).toEqual(keyboard);
        const firstAfter = await requireToasterProject(page, { trackId: first.trackId });
        expect(firstAfter.raw).toEqual(first.raw);
        expect(firstAfter.projected).toEqual(first.projected);

        await chooseProjectDirectory(page);
        await page.getByRole('button', { name: 'Project menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Save/ }).click();
        await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0);
        const binaries = await page.evaluate(
            async ({ entryPath, projectId, trackId, deviceId }) => {
                const { arrangement, crdt }: typeof import('./persistedHydrationEntry') = await import(entryPath);
                type Tracks = NonNullable<typeof arrangement.trackStore.value>;
                const root = await navigator.storage.getDirectory();
                const chosen = await root.getDirectoryHandle('chosen-project-directory');
                const projects = await chosen.getDirectoryHandle('projects');
                const directory = await projects.getDirectoryHandle(projectId);
                const files = [];
                for await (const [name, handle] of directory as AsyncIterable<
                    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
                >) {
                    if (name.endsWith('.sdaw') && 'getFile' in handle) {
                        const file = await handle.getFile();
                        const decoded = await crdt.prepareExternalProjectDocument(
                            new Uint8Array(await file.arrayBuffer()),
                            projectId
                        );
                        const tracks = decoded.rootMediaSlots.tracks as Tracks;
                        files.push({
                            header: await file.slice(0, 4).text(),
                            device:
                                tracks.tracks
                                    .find((track) => track.id === trackId)
                                    ?.devices.find((device) => device.id === deviceId) ?? null,
                        });
                    }
                }
                return files;
            },
            { entryPath: ENTRY, projectId: keyboard.projectId, trackId: keyboard.trackId, deviceId: keyboard.deviceId }
        );
        expect(binaries).toContainEqual({ header: 'SDAW', device: keyboard.raw });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 45_000 });
        const { history, ...saved } = keyboard;
        await expect
            .poll(
                async () => {
                    const snapshot = await readTarget();
                    if (!snapshot) {
                        return null;
                    }
                    const { history, ...reopened } = snapshot;
                    return { reopened, latestType: history.latestType };
                },
                { timeout: 15_000 }
            )
            .toEqual({ reopened: saved, latestType: history.latestType });
        await expect(undo).toBeEnabled();
        await undo.click();
        const { history: _committedHistory, ...committedProject } = committed;
        await expect
            .poll(async () => {
                const snapshot = await readTarget();
                if (!snapshot) return null;
                const { history, ...project } = snapshot;
                return { project, latestType: history.latestType };
            })
            .toEqual({ project: committedProject, latestType: 'setToasterMasterGain' });
    });

    test('the second Toaster replays its factory kit pick and reopens the saved kit', async ({ page }) => {
        const first = await requireToasterProject(page);
        const close = page.getByRole('button', { name: 'Close Toaster', exact: true });
        await close.click();
        await expect(close).toHaveCount(0);
        await open_browser_instrument({ page, instrument: 'Toaster' });
        const toaster = await requireToasterProject(page, { excludeTrackId: first.trackId });
        const selection = { trackId: toaster.trackId };
        const readTarget = () => readToasterProject(page, selection);
        await page.evaluate(
            async ({ entryPath, trackId }) => {
                const { command }: typeof import('./persistedHydrationEntry') = await import(entryPath);
                await command.executeAppAction({
                    type: 'renameTrack',
                    payload: { trackId, name: 'Kit history sentinel' },
                });
            },
            { entryPath: ENTRY, trackId: toaster.trackId }
        );

        const before = await requireToasterProject(page, selection);
        const { history: beforeHistory, ...beforeProject } = before;
        const rye = page.getByRole('button', { name: 'Load kit Rye 909', exact: true });
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        expect(before.trackName).toBe('Kit history sentinel');
        expect(before.rawHasChunk).toBe(false);
        expect(before.projectedHasChunk).toBe(false);
        await expect(rye).toHaveAttribute('aria-pressed', 'false');
        expect(beforeHistory.latestType).toBe('renameTrack');

        await rye.click();
        await expect(rye).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => (await readTarget())?.history.count).toBe(beforeHistory.count + 1);
        const selected = await requireToasterProject(page, selection);
        expect(selected.rawHasChunk).toBe(true);
        expect(selected.projectedHasChunk).toBe(true);
        expect(selected.raw).toEqual(selected.projected);
        expect(selected.otherRows).toEqual(before.otherRows);
        expect(selected.automation).toEqual(before.automation);
        expect(selected.history.latestType).toBe('setToasterFactoryKit');
        expect(selected.history.latestGroupId).toBeTruthy();

        await page.getByRole('button', { name: 'Trigger Kick', exact: true }).click();
        expect(await readTarget()).toEqual(selected);

        await undo.click();
        await expect.poll(() => readTarget()).toEqual(before);
        await expect(rye).toHaveAttribute('aria-pressed', 'false');

        await redo.click();
        await expect(rye).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => readTarget()).toEqual(selected);

        await chooseProjectDirectory(page);
        await page.getByRole('button', { name: 'Project menu', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Save/ }).click();
        await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0);
        const binaries = await page.evaluate(
            async ({ entryPath, projectId, trackId, deviceId }) => {
                const { arrangement, crdt }: typeof import('./persistedHydrationEntry') = await import(entryPath);
                type Tracks = NonNullable<typeof arrangement.trackStore.value>;
                const root = await navigator.storage.getDirectory();
                const chosen = await root.getDirectoryHandle('chosen-project-directory');
                const projects = await chosen.getDirectoryHandle('projects');
                const directory = await projects.getDirectoryHandle(projectId);
                const files = [];
                for await (const [name, handle] of directory as AsyncIterable<
                    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
                >) {
                    if (name.endsWith('.sdaw') && 'getFile' in handle) {
                        const file = await handle.getFile();
                        const decoded = await crdt.prepareExternalProjectDocument(
                            new Uint8Array(await file.arrayBuffer()),
                            projectId
                        );
                        const tracks = decoded.rootMediaSlots.tracks as Tracks;
                        files.push({
                            header: await file.slice(0, 4).text(),
                            device:
                                tracks.tracks
                                    .find((track) => track.id === trackId)
                                    ?.devices.find((device) => device.id === deviceId) ?? null,
                        });
                    }
                }
                return files;
            },
            { entryPath: ENTRY, projectId: selected.projectId, trackId: selected.trackId, deviceId: selected.deviceId }
        );
        expect(binaries).toContainEqual({ header: 'SDAW', device: selected.raw });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 45_000 });
        const { history, ...saved } = selected;
        await expect
            .poll(
                async () => {
                    const snapshot = await readTarget();
                    if (!snapshot) {
                        return null;
                    }
                    const { history, ...reopened } = snapshot;
                    return { reopened, latestType: history.latestType, latestGroupId: history.latestGroupId };
                },
                { timeout: 15_000 }
            )
            .toEqual({ reopened: saved, latestType: history.latestType, latestGroupId: history.latestGroupId });

        await expect(undo).toBeEnabled();
        await undo.click();
        await expect
            .poll(async () => {
                const snapshot = await readTarget();
                if (!snapshot) {
                    return null;
                }
                const { history: _history, ...project } = snapshot;
                return project;
            })
            .toEqual(beforeProject);
    });
});
