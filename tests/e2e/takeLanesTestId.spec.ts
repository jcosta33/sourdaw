import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

function bassTrackRow(page: Page) {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .filter({ has: page.getByText('Bass', { exact: true }) })
        .first();
}

function variationToggle(page: Page) {
    return bassTrackRow(page).getByRole('button', { name: 'Toggle variation lanes' });
}

async function openTakeLanes(page: Page): Promise<void> {
    await bassTrackRow(page).scrollIntoViewIfNeeded();
    const toggle = variationToggle(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Add take' })).toBeVisible();
}

test.describe('Take lanes & comp — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('variation lanes toggle expands the take panel', async ({ page }) => {
        await openTakeLanes(page);
        await expect(page.getByText('Takes · Bass')).toBeVisible();
    });

    test('add take button is present when variation lanes are open', async ({ page }) => {
        await openTakeLanes(page);
        const addTake = page.getByTestId('take-lane-add');
        await expect(addTake).toBeVisible();
        await expect(addTake).toHaveAttribute('aria-label', 'Add take');
    });

    test('flatten comp is disabled until a take lane exists', async ({ page }) => {
        await openTakeLanes(page);
        const flatten = page.getByRole('button', { name: 'Flatten comp' });
        await expect(flatten).toBeVisible();
        await expect(flatten).toBeDisabled();

        await page.getByRole('button', { name: 'Initialize take lane' }).click();
        await expect(flatten).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Initialize take lane' })).toHaveCount(0);
    });

    test('add take creates a named take', async ({ page }) => {
        await openTakeLanes(page);
        await expect(page.getByText('0 takes · 0 comp regions')).toBeVisible();

        await page.getByTestId('take-lane-add').click();

        await expect(page.getByText('1 take · 0 comp regions')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Promote Take 1 to main take' })).toBeVisible();
    });

    test('transport play/stop works with take lanes open', async ({ page }) => {
        await openTakeLanes(page);

        const playhead = page.getByTestId('transport-playhead');
        const play = page.getByTestId('transport-play');
        await expect(playhead).toHaveText(/1\.1\.000/);
        await expect(play).toHaveAttribute('aria-label', 'Play');

        await play.click();
        await expect(playhead).toHaveText(/\d+\.\d+\.\d+/, { timeout: 10_000 });
        await expect(playhead).not.toHaveText('1.1.000');
        await expect(play).toHaveAttribute('aria-label', 'Pause');

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await expect(play).toHaveAttribute('aria-label', 'Play');
    });
});
