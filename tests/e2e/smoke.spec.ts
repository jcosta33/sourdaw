import { expect, test, type Browser, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

function dirtyIndicator(page: Page) {
    return page.getByTitle('Unsaved changes');
}

function trackList(page: Page) {
    return page.getByRole('grid', { name: /Track list/i }).first();
}

async function blockExternalRequests(page: Page): Promise<() => void> {
    const unexpectedRequests: string[] = [];
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            await route.continue();
            return;
        }
        unexpectedRequests.push(url.toString());
        await route.abort('blockedbyclient');
    });
    return () => expect(unexpectedRequests, 'offline smoke blocked external runtime requests').toEqual([]);
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
        const assertOffline = await openNewProject(page);

        const playbackControls = page.getByRole('group', { name: 'Playback controls' });
        const playhead = page.getByTestId('transport-playhead');
        const playheadPosition = async () => (await playhead.innerText()).replaceAll(/\s/g, '');
        const initialPosition = await playheadPosition();
        const play = page.getByTestId('transport-play');
        await play.click();
        await expect(playbackControls.getByRole('status')).toHaveText('Playing');
        await expect(play).toHaveAccessibleName('Pause');

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
