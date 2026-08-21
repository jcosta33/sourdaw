import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

function trackList(page: Page) {
    return page.getByRole('grid', { name: /Track list/i }).first();
}

test.describe('EDM template tracks and transport', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('EDM template names Kick, Bass, and Supersaw Lead', async ({ page }) => {
        const list = trackList(page);
        await expect(list.getByText('Kick', { exact: true })).toBeVisible();
        await expect(list.getByText('Bass', { exact: true })).toBeVisible();
        await expect(list.getByText('Supersaw Lead', { exact: true })).toBeVisible();
        await expect(list.getByText('Drums', { exact: true })).toBeVisible();
    });

    test('muting Kick leaves Bass unmuted', async ({ page }) => {
        const list = trackList(page);
        const muteKick = list.getByRole('button', { name: 'Mute Kick', exact: true });
        const muteBass = list.getByRole('button', { name: 'Mute Bass', exact: true });

        await expect(muteKick).toHaveAttribute('data-active', 'false');
        await expect(muteBass).toHaveAttribute('data-active', 'false');

        await muteKick.click();
        await expect(list.getByRole('button', { name: 'Unmute Kick', exact: true })).toHaveAttribute(
            'data-active',
            'true'
        );
        await expect(muteBass).toHaveAttribute('data-active', 'false');
    });

    test('soloing Kick leaves Bass unsoloed', async ({ page }) => {
        const list = trackList(page);
        const soloKick = list.getByRole('button', { name: 'Solo Kick', exact: true });
        const soloBass = list.getByRole('button', { name: 'Solo Bass', exact: true });

        await expect(soloKick).toHaveAttribute('data-active', 'false');
        await expect(soloBass).toHaveAttribute('data-active', 'false');

        await soloKick.click();
        await expect(list.getByRole('button', { name: 'Unsolo Kick', exact: true })).toHaveAttribute(
            'data-active',
            'true'
        );
        await expect(soloBass).toHaveAttribute('data-active', 'false');
    });

    test('play moves the playhead off 1.1.000 and stop restores it', async ({ page }) => {
        const play = page.getByRole('button', { name: 'Play', exact: true });
        const playhead = page.getByTestId('transport-playhead');

        await expect(play).toHaveAttribute('aria-label', 'Play');
        await expect(playhead).toHaveText(/\d+\.\d+\.\d+/);
        await expect(playhead).toContainText('1.1.000');

        await play.click();
        await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveAttribute('aria-label', 'Pause');
        await expect(playhead).toHaveText(/\d+\.\d+\.\d+/);
        await expect(playhead).not.toContainText('1.1.000');

        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-label', 'Play');
        await expect(playhead).toContainText('1.1.000');
    });

    test('EDM template playhead starts at 1.1.000', async ({ page }) => {
        const playhead = page.getByTestId('transport-playhead');
        await expect(playhead).toHaveText(/\d+\.\d+\.\d+/);
        await expect(playhead).toContainText('1.1.000');
        await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-label', 'Play');
    });
});
