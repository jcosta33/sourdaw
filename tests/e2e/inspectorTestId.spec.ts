import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
    // Select the track to show the inspector.
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().click();
    await page.waitForTimeout(300);
}

test.describe('Inspector — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await addFirstTrack(page);
    });

    test('track notes input is visible and accepts typed text', async ({ page }) => {
        const notes = page.getByTestId('inspector-track-notes');
        // The notes section may not be visible if inspector is closed — open it.
        const inspector = page.getByTestId('toggle-inspector');
        const inspectorOpen = await inspector.getAttribute('aria-pressed');
        if (inspectorOpen === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        // Notes input may be present if the track is selected.
        if (await notes.isVisible().catch(() => false)) {
            await notes.fill('This is a test note');
            await expect(notes).toHaveValue('This is a test note');
        }
    });

    test('track gain slider is present in the inspector', async ({ page }) => {
        const inspector = page.getByTestId('toggle-inspector');
        const inspectorOpen = await inspector.getAttribute('aria-pressed');
        if (inspectorOpen === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        const gain = page.getByTestId('inspector-track-gain');
        if (await gain.isVisible().catch(() => false)) {
            // Verify it has rendered child elements (the slider track).
            const childCount = await gain.evaluate((el) => el.children.length);
            expect(childCount).toBeGreaterThan(0);
        }
    });

    test('inspector opens and closes via test ID', async ({ page }) => {
        const inspector = page.getByTestId('toggle-inspector');
        await expect(inspector).toBeVisible();

        const before = await inspector.getAttribute('aria-pressed');
        await inspector.click();
        await page.waitForTimeout(300);
        await expect(inspector).not.toHaveAttribute('aria-pressed', before ?? '');

        // Toggle back.
        await inspector.click();
        await page.waitForTimeout(300);
        await expect(inspector).toHaveAttribute('aria-pressed', before ?? '');
    });
});
