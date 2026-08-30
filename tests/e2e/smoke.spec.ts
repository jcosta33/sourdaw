import { expect, test, type Locator, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const OFFLINE_IDLE_WINDOW_MS = 500;
const MAX_SCHEDULED_OSCILLATOR_LEAD_SECONDS = 0.1;
const MANUAL_SAVE_PREFERENCES = superjsonStringify({ autoSave: false });
const CRDT_MODULE_DOCUMENT = '/src/modules/CrdtDocument/models/CrdtRootLineage.ts';
const CRDT_DATABASE_NAME = 'sourdaw-crdt-docs';

test.use({ serviceWorkers: 'block' });

function dirtyIndicator(page: Page) {
    return page.getByTitle('Unsaved changes');
}

function trackList(page: Page) {
    return page.getByRole('grid', { name: /Track list/i }).first();
}

function isLoopbackEndpoint(url: URL): boolean {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

async function blockExternalRequests(page: Page): Promise<() => Promise<void>> {
    const unexpectedEndpoints = { requests: [] as string[], webSockets: [] as string[] };
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (isLoopbackEndpoint(url)) {
            await route.continue();
            return;
        }
        unexpectedEndpoints.requests.push(url.toString());
        await route.abort('blockedbyclient');
    });
    await page.routeWebSocket('**/*', async (webSocket) => {
        const url = new URL(webSocket.url());
        if (isLoopbackEndpoint(url)) {
            webSocket.connectToServer();
            return;
        }
        unexpectedEndpoints.webSockets.push(url.toString());
        await webSocket.close({ code: 1008, reason: 'External network blocked' });
    });
    return async () => {
        await page.waitForTimeout(OFFLINE_IDLE_WINDOW_MS);
        expect(unexpectedEndpoints, 'offline smoke blocked external runtime endpoints').toEqual({
            requests: [],
            webSockets: [],
        });
    };
}

type AudioContextTestControl = {
    graphState: () => Promise<string>;
    suspend: () => Promise<string | undefined>;
    count: () => Promise<number>;
    lead: () => Promise<number>;
    reset: () => Promise<void>;
    hasContextMismatch: () => Promise<boolean>;
};

async function observeAudioContext(page: Page): Promise<AudioContextTestControl> {
    await page.addInitScript(() => {
        // Resolved per call, never captured: an init script runs before the
        // parser has produced `<html>`, so `document.documentElement` is still
        // null here and only exists by the time the app builds an audio graph.
        const root = () => document.documentElement;
        const nativeCreateGain = AudioContext.prototype.createGain;
        const nativeResume = AudioContext.prototype.resume;
        const nativeStart = OscillatorNode.prototype.start;
        let graphContext: AudioContext | undefined;

        const reportContextMismatch = () => {
            root().dataset.audioContextMismatch = 'true';
        };
        const captureGraphContext = (context: AudioContext) => {
            if (!graphContext) {
                graphContext = context;
                return;
            }
            if (graphContext !== context) {
                reportContextMismatch();
            }
        };

        AudioContext.prototype.createGain = function (this: AudioContext): GainNode {
            const gain = nativeCreateGain.call(this);
            captureGraphContext(this);
            return gain;
        };
        AudioContext.prototype.resume = async function (this: AudioContext): Promise<void> {
            if (graphContext !== this) {
                reportContextMismatch();
            }
            await nativeResume.call(this);
            root().dataset.audioContextGraphState = graphContext?.state ?? 'missing';
        };
        OscillatorNode.prototype.start = function (
            this: OscillatorNode,
            ...args: Parameters<OscillatorNode['start']>
        ): void {
            nativeStart.apply(this, args);
            if (graphContext !== this.context) {
                reportContextMismatch();
                return;
            }
            const currentTime = this.context.currentTime;
            const scheduledTime = args[0] ?? currentTime;
            const lead = scheduledTime - currentTime;
            const count = Number(root().dataset.scheduledOscillatorCount ?? '0');
            root().dataset.scheduledOscillatorCount = String(count + 1);
            root().dataset.scheduledOscillatorLead = String(lead);
        };
        document.addEventListener('sourdaw-test-reset-scheduled-oscillator-count', () => {
            root().dataset.scheduledOscillatorCount = '0';
            delete root().dataset.scheduledOscillatorLead;
        });
        document.addEventListener('sourdaw-test-read-audio-context-state', () => {
            root().dataset.audioContextGraphState = graphContext?.state ?? 'missing';
            document.dispatchEvent(new Event('sourdaw-test-audio-context-state-read'));
        });
        document.addEventListener('sourdaw-test-suspend-audio-context', () => {
            void (async () => {
                if (!graphContext) {
                    root().dataset.audioContextGraphState = 'missing';
                } else {
                    await graphContext.suspend();
                    root().dataset.audioContextGraphState = graphContext.state;
                }
                document.dispatchEvent(new Event('sourdaw-test-audio-context-suspended'));
            })();
        });
    });
    return {
        graphState: () =>
            page.evaluate(
                () =>
                    new Promise<string>((resolve) => {
                        document.addEventListener(
                            'sourdaw-test-audio-context-state-read',
                            () => resolve(document.documentElement.dataset.audioContextGraphState ?? 'missing'),
                            { once: true }
                        );
                        document.dispatchEvent(new Event('sourdaw-test-read-audio-context-state'));
                    })
            ),
        suspend: () =>
            page.evaluate(
                () =>
                    new Promise<string | undefined>((resolve) => {
                        document.addEventListener(
                            'sourdaw-test-audio-context-suspended',
                            () => resolve(document.documentElement.dataset.audioContextGraphState),
                            { once: true }
                        );
                        document.dispatchEvent(new Event('sourdaw-test-suspend-audio-context'));
                    })
            ),
        count: async () =>
            Number(await page.evaluate(() => document.documentElement.dataset.scheduledOscillatorCount ?? '0')),
        lead: async () =>
            Number(await page.evaluate(() => document.documentElement.dataset.scheduledOscillatorLead ?? 'NaN')),
        reset: () =>
            page.evaluate(() => {
                document.dispatchEvent(new Event('sourdaw-test-reset-scheduled-oscillator-count'));
            }),
        hasContextMismatch: async () =>
            (await page.evaluate(() => document.documentElement.dataset.audioContextMismatch)) === 'true',
    };
}

type OpenNewProjectOptions = {
    firstPaintTimeoutMs?: number;
};

async function openNewProject(
    page: Page,
    { firstPaintTimeoutMs }: OpenNewProjectOptions = {}
): Promise<() => Promise<void>> {
    const assertOffline = await blockExternalRequests(page);
    await setupWorkspace(page, {
        localStorage: [{ name: 'sourdaw-preferences', value: MANUAL_SAVE_PREFERENCES }],
    });
    await launch_new_project(page, { firstPaintTimeoutMs });
    return assertOffline;
}

async function addMidiTrack(page: Page): Promise<void> {
    const list = trackList(page);
    const before = await list.getByRole('row').count();
    await page.keyboard.press(`${MODIFIER}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => list.getByRole('row').count()).toBeGreaterThan(before);
    await list.getByText('MIDI', { exact: true }).click();
}

async function midiLaneY(page: Page): Promise<number> {
    const timeline = page.getByLabel('Timeline editor surface');
    const muteBox = await page.getByRole('button', { name: 'Mute MIDI' }).boundingBox();
    const timelineBox = await timeline.boundingBox();
    if (!muteBox || !timelineBox) {
        throw new Error('Mute MIDI or timeline surface has no bounding box');
    }
    return Math.min(Math.max(muteBox.y - timelineBox.y + muteBox.height / 2, 8), timelineBox.height - 8);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function createPlayableMidiClip(page: Page): Promise<Locator> {
    await addMidiTrack(page);
    const timeline = page.getByLabel('Timeline editor surface');
    await expect(timeline).toBeVisible();
    const y = await midiLaneY(page);
    await timeline.click({ button: 'right', position: { x: 30, y } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await timeline.dblclick({ position: { x: 30, y } });
    const pianoRoll = page.getByLabel('Piano roll editor');
    await expect(pianoRoll).toBeVisible();
    await openBottomTab(page, 'Editor');

    const paint = page.getByRole('button', { name: 'Toggle paint mode' });
    if ((await paint.getAttribute('aria-pressed')) !== 'true') {
        await paint.click();
    }
    await pianoRoll.click({ position: { x: 40, y: 130 } });
    await expect(page.getByTestId('selected-clip-note-count')).toHaveText('1 note');
    return pianoRoll;
}

async function renameProject(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: 'Untitled Project' }).click();
    const projectNameInput = page.locator('input:focus');
    await projectNameInput.fill(name);
    await projectNameInput.press('Enter');
}

async function startBlankProject(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Project menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New Project', exact: true }).click();
    await expect(page.getByTestId('project-name')).toHaveText('Untitled Project');
    await expect(page.getByText('Add your first track')).toBeVisible();
    await expect(page.getByRole('grid', { name: /Track list/i })).toHaveCount(0);
}

async function clearCrdtDatabase(page: Page): Promise<void> {
    await page.evaluate(async (databaseName) => {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(databaseName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
            request.onblocked = () => reject(new Error('IndexedDB delete was blocked'));
        });
    }, CRDT_DATABASE_NAME);
}

async function openSavedProjectInFreshPage(page: Page, name: string) {
    const browserContext = page.context();
    const appRootUrl = new URL('/', page.url()).toString();
    await page.close();

    const realm = await browserContext.newPage();
    const assertRealmOffline = await blockExternalRequests(realm);
    try {
        await realm.goto(new URL(CRDT_MODULE_DOCUMENT, appRootUrl).toString());
        await clearCrdtDatabase(realm);
        await assertRealmOffline();
    } finally {
        await realm.close();
    }

    const reopenedPage = await browserContext.newPage();
    const assertOffline = await blockExternalRequests(reopenedPage);
    await reopenedPage.goto(appRootUrl);
    const launchScreen = reopenedPage.getByLabel('Sourdaw — start a project');
    await expect(launchScreen).toBeVisible({ timeout: 30_000 });
    const recentProject = reopenedPage.getByRole('button', { name: `Open recent project ${name}` });
    await expect(recentProject).toBeVisible();
    await recentProject.click();
    await wait_for_workspace_ready(reopenedPage);
    const projectName = reopenedPage.getByTestId('project-name');
    await expect(projectName).toHaveText(name, { timeout: 30_000 });
    return { assertOffline, page: reopenedPage };
}

test.describe('Offline project smoke', () => {
    test('launches a new project into the workspace', async ({ page }) => {
        // This first offline leg pays the cold first-run application transform.
        test.setTimeout(150_000);
        const assertOffline = await openNewProject(page, { firstPaintTimeoutMs: 90_000 });

        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();
        await assertOffline();
    });

    test('saves and reopens an edited project', async ({ page }) => {
        const assertOffline = await openNewProject(page);
        await expect(dirtyIndicator(page)).toHaveCount(0);

        await renameProject(page, 'Smoke Persistence');

        await addMidiTrack(page);
        await expect(dirtyIndicator(page)).toBeVisible();

        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(dirtyIndicator(page)).toHaveCount(0);
        await startBlankProject(page);
        await assertOffline();

        const reopened = await openSavedProjectInFreshPage(page, 'Smoke Persistence');
        try {
            await expect(reopened.page.getByTestId('project-name')).toHaveText('Smoke Persistence');
            await expect(trackList(reopened.page).getByText('MIDI', { exact: true })).toBeVisible();
            await reopened.assertOffline();
        } finally {
            await reopened.page.close();
        }
    });

    test('advances the playhead during playback and restores it on stop', async ({ page }) => {
        const audioContext = await observeAudioContext(page);
        const assertOffline = await openNewProject(page);
        await createPlayableMidiClip(page);

        const playbackControls = page.getByRole('group', { name: 'Playback controls' });
        const playhead = page.getByTestId('transport-playhead');
        const playheadPosition = async () => (await playhead.innerText()).replaceAll(/\s/g, '');
        const initialPosition = await playheadPosition();
        const play = page.getByTestId('transport-play');
        await audioContext.reset();
        await expect.poll(audioContext.count).toBe(0);
        await expect.poll(audioContext.hasContextMismatch).toBe(false);
        await audioContext.suspend();
        await expect.poll(audioContext.graphState).toBe('suspended');
        await play.click();
        await expect(playbackControls.getByRole('status')).toHaveText('Playing');
        await expect(play).toHaveAccessibleName('Pause');
        await expect.poll(audioContext.graphState).toBe('running');
        await expect.poll(audioContext.hasContextMismatch).toBe(false);
        await expect.poll(audioContext.count).toBeGreaterThan(0);
        await expect.poll(audioContext.lead).toBeGreaterThanOrEqual(0);
        await expect.poll(audioContext.lead).toBeLessThanOrEqual(MAX_SCHEDULED_OSCILLATOR_LEAD_SECONDS);

        await expect.poll(playheadPosition).not.toBe(initialPosition);
        const firstAdvancedPosition = await playheadPosition();
        await expect.poll(playheadPosition).not.toBe(firstAdvancedPosition);

        await page.getByTestId('transport-stop').click();
        await expect(playbackControls.getByRole('status')).toHaveText('Stopped');
        await expect(play).toHaveAccessibleName('Play');
        await expect.poll(playheadPosition).toBe(initialPosition);
        const stoppedPosition = await playheadPosition();
        await page.waitForTimeout(250);
        await expect(playheadPosition()).resolves.toBe(stoppedPosition);
        await assertOffline();
    });

    test('undo restores durable project truth before its track edit', async ({ page }) => {
        const assertOffline = await openNewProject(page);
        await renameProject(page, 'Smoke Undo Persistence');

        await addMidiTrack(page);
        const midiTrack = trackList(page).getByText('MIDI', { exact: true });
        await expect(midiTrack).toBeVisible();

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(midiTrack).toHaveCount(0);
        await expect(page.getByText('Add your first track')).toBeVisible();

        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(dirtyIndicator(page)).toHaveCount(0);
        await startBlankProject(page);
        await assertOffline();

        const reopened = await openSavedProjectInFreshPage(page, 'Smoke Undo Persistence');
        try {
            await expect(reopened.page.getByTestId('project-name')).toHaveText('Smoke Undo Persistence');
            await expect(trackList(reopened.page).getByText('MIDI', { exact: true })).toHaveCount(0);
            await expect(reopened.page.getByText('Add your first track')).toBeVisible();
            await reopened.assertOffline();
        } finally {
            await reopened.page.close();
        }
    });
});
