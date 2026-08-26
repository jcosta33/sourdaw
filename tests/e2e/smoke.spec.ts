import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

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

async function blockExternalRequests(page: Page): Promise<() => void> {
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
    return () =>
        expect(unexpectedEndpoints, 'offline smoke blocked external runtime endpoints').toEqual({
            requests: [],
            webSockets: [],
        });
}

async function observeAudioContextResumeState(page: Page): Promise<() => Promise<string | undefined>> {
    await page.addInitScript(() => {
        const nativeResume = AudioContext.prototype.resume;
        AudioContext.prototype.resume = async function (this: AudioContext): Promise<void> {
            await nativeResume.call(this);
            document.documentElement.dataset.audioContextResumeState = this.state;
        };
    });
    return () => page.evaluate(() => document.documentElement.dataset.audioContextResumeState);
}

async function observeScheduledOscillatorCount(page: Page): Promise<() => Promise<number>> {
    await page.addInitScript(() => {
        const nativeStart = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function (
            this: OscillatorNode,
            ...args: Parameters<OscillatorNode['start']>
        ): void {
            const count = Number(document.documentElement.dataset.scheduledOscillatorCount ?? '0');
            document.documentElement.dataset.scheduledOscillatorCount = String(count + 1);
            nativeStart.apply(this, args);
        };
    });
    return async () =>
        Number(await page.evaluate(() => document.documentElement.dataset.scheduledOscillatorCount ?? '0'));
}

async function openNewProject(page: Page): Promise<() => void> {
    const assertOffline = await blockExternalRequests(page);
    await setupWorkspace(page);
    await launch_new_project(page);
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
    await timeline.click({ button: 'right', position: { x: 300, y } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await timeline.dblclick({ position: { x: 300, y } });
    const pianoRoll = page.getByLabel('Piano roll editor');
    await expect(pianoRoll).toBeVisible();
    await openBottomTab(page, 'Editor');

    const paint = page.getByRole('button', { name: 'Toggle paint mode' });
    if ((await paint.getAttribute('aria-pressed')) !== 'true') {
        await paint.click();
    }
    await pianoRoll.click({ position: { x: 200, y: 130 } });
    await expect(page.getByTestId('selected-clip-note-count')).toHaveText('1 note');
    return pianoRoll;
}

async function renameProject(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: 'Untitled Project' }).click();
    const projectNameInput = page.locator('input:focus');
    await projectNameInput.fill(name);
    await projectNameInput.press('Enter');
}

async function openSavedProjectInFreshContext(browser: Browser, page: Page, name: string) {
    const appRootUrl = new URL('/', page.url()).toString();
    const storageState = await page.context().storageState({ indexedDB: true });
    const context = await browser.newContext({ storageState });
    const reopenedPage = await context.newPage();
    const assertOffline = await blockExternalRequests(reopenedPage);
    await reopenedPage.goto(appRootUrl);
    await launch_new_project(reopenedPage);
    await reopenedPage.getByRole('button', { name: 'Project menu' }).click();
    await reopenedPage.getByRole('menuitem', { name }).click();
    return { assertOffline, context, page: reopenedPage };
}

test.describe('Offline project smoke', () => {
    test('launches a new project into the workspace', async ({ page }) => {
        const assertOffline = await openNewProject(page);

        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();
        assertOffline();
    });

    test('saves and reopens an edited project', async ({ page, browser }) => {
        const assertOffline = await openNewProject(page);
        await expect(dirtyIndicator(page)).toHaveCount(0);

        await renameProject(page, 'Smoke Persistence');

        await addMidiTrack(page);
        await expect(dirtyIndicator(page)).toBeVisible();

        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(dirtyIndicator(page)).toHaveCount(0);

        const reopened = await openSavedProjectInFreshContext(browser, page, 'Smoke Persistence');
        try {
            await expect(reopened.page.getByRole('button', { name: 'Smoke Persistence' })).toBeVisible();
            await expect(trackList(reopened.page).getByText('MIDI', { exact: true })).toBeVisible();
            reopened.assertOffline();
        } finally {
            await reopened.context.close();
        }
        assertOffline();
    });

    test('advances the playhead during playback and restores it on stop', async ({ page }) => {
        const audioContextResumeState = await observeAudioContextResumeState(page);
        const scheduledOscillatorCount = await observeScheduledOscillatorCount(page);
        const assertOffline = await openNewProject(page);
        await createPlayableMidiClip(page);

        const playbackControls = page.getByRole('group', { name: 'Playback controls' });
        const playhead = page.getByTestId('transport-playhead');
        const playheadPosition = async () => (await playhead.innerText()).replaceAll(/\s/g, '');
        const initialPosition = await playheadPosition();
        const play = page.getByTestId('transport-play');
        await play.click();
        await expect(playbackControls.getByRole('status')).toHaveText('Playing');
        await expect(play).toHaveAccessibleName('Pause');
        await expect.poll(audioContextResumeState).toBe('running');
        await expect.poll(scheduledOscillatorCount).toBeGreaterThan(0);

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
        assertOffline();
    });

    test('undo restores durable project truth before its track edit', async ({ page, browser }) => {
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

        const reopened = await openSavedProjectInFreshContext(browser, page, 'Smoke Undo Persistence');
        try {
            await expect(reopened.page.getByRole('button', { name: 'Smoke Undo Persistence' })).toBeVisible();
            await expect(trackList(reopened.page).getByText('MIDI', { exact: true })).toHaveCount(0);
            await expect(reopened.page.getByText('Add your first track')).toBeVisible();
            reopened.assertOffline();
        } finally {
            await reopened.context.close();
        }
        assertOffline();
    });
});
