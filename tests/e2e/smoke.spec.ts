import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

function dirtyIndicator(page: Page) {
    return page.getByTitle('Unsaved changes');
}

function trackList(page: Page) {
    return page.getByRole('grid', { name: /Track list/i }).first();
}

async function openNewProject(page: Page): Promise<void> {
    await setupWorkspace(page);
    await launch_new_project(page);
}

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MODIFIER}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
}

test.describe('Offline project smoke', () => {
    test('launches a new project into the workspace', async ({ page }) => {
        await openNewProject(page);

        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();
    });

    test('saves an opened project after an edit', async ({ page }) => {
        await openNewProject(page);
        await expect(dirtyIndicator(page)).toHaveCount(0);

        await addMidiTrack(page);
        await expect(dirtyIndicator(page)).toBeVisible();

        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(dirtyIndicator(page)).toHaveCount(0);
    });

    test('advances the playhead during playback and restores it on stop', async ({ page }) => {
        await openNewProject(page);

        const playhead = page.getByTestId('transport-playhead');
        const playheadPosition = async () => (await playhead.innerText()).replaceAll(/\s/g, '');
        const initialPosition = await playheadPosition();
        await page.getByTestId('transport-play').click();

        await expect.poll(playheadPosition).not.toBe(initialPosition);

        await page.getByTestId('transport-stop').click();
        await expect.poll(playheadPosition).toBe(initialPosition);
    });

    test('undo restores the project before its track edit', async ({ page }) => {
        await openNewProject(page);

        await addMidiTrack(page);
        const midiTrack = trackList(page).getByText('MIDI', { exact: true });
        await expect(midiTrack).toBeVisible();

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(midiTrack).toHaveCount(0);
    });
});
