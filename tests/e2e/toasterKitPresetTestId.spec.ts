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
