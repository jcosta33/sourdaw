import { expect, test, type Browser, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const AUDIO_CONTEXT_RESUME_STATES_KEY = '__sourdawE2eAudioContextResumeStates';

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

async function observeAudioContextResumes(page: Page): Promise<() => Promise<unknown[]>> {
    await page.addInitScript((resumeStatesKey) => {
        const resumeStates: AudioContextState[] = [];
        Object.defineProperty(window, resumeStatesKey, { value: resumeStates });
        const resume = AudioContext.prototype.resume;
        AudioContext.prototype.resume = async function (this: AudioContext): Promise<void> {
            await resume.call(this);
            resumeStates.push(this.state);
        };
    }, AUDIO_CONTEXT_RESUME_STATES_KEY);
    return () =>
        page.evaluate((resumeStatesKey) => {
            const resumeStates = Reflect.get(window, resumeStatesKey);
            return Array.isArray(resumeStates) ? resumeStates : [];
        }, AUDIO_CONTEXT_RESUME_STATES_KEY);
}

async function openNewProject(page: Page): Promise<() => void> {
    const assertOffline = await blockExternalRequests(page);
    await setupWorkspace(page);
    await launch_new_project(page);
    return assertOffline;
}

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MODIFIER}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
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
        const audioContextResumeStates = await observeAudioContextResumes(page);
        const assertOffline = await openNewProject(page);

        const playbackControls = page.getByRole('group', { name: 'Playback controls' });
        const playhead = page.getByTestId('transport-playhead');
        const playheadPosition = async () => (await playhead.innerText()).replaceAll(/\s/g, '');
        const initialPosition = await playheadPosition();
        const play = page.getByTestId('transport-play');
        await play.click();
        await expect(playbackControls.getByRole('status')).toHaveText('Playing');
        await expect(play).toHaveAccessibleName('Pause');
        await expect.poll(audioContextResumeStates).toContain('running');

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
