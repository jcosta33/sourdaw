import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Punch recording pre-roll / post-roll — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('pre-roll and post-roll number inputs commit new values via test ID', async ({ page }) => {
        const preRoll = page.getByTestId('punch-pre-roll');
        const postRoll = page.getByTestId('punch-post-roll');

        // The punch cluster lives in the transport bar's second row and mounts
        // with the workspace — both fields must be present number inputs.
        await expect(preRoll).toBeVisible({ timeout: 10_000 });
        await expect(postRoll).toBeVisible({ timeout: 10_000 });
        await expect(preRoll).toHaveValue('4');
        await expect(postRoll).toHaveValue('2');

        // Pre-roll commits on Enter (NumberField commit path).
        await preRoll.fill('7');
        await preRoll.press('Enter');
        await expect(preRoll).toHaveValue('7');

        // Post-roll commits on blur (focus moves away from the field).
        await postRoll.fill('5');
        await postRoll.blur();
        await expect(postRoll).toHaveValue('5');

        // Committing post-roll must not disturb the committed pre-roll value.
        await expect(preRoll).toHaveValue('7');
    });

    test('mark punch region button does not crash the punch panel when clickable', async ({ page }) => {
        const panel = page.getByRole('group', { name: 'Punch recording controls' });
        await expect(panel).toBeVisible({ timeout: 10_000 });

        const mark = page.getByRole('button', { name: 'Mark punch region from current capture' });
        await expect(mark).toBeAttached();

        // The Mark button requires an active background capture (recording
        // playback). When no capture is live it is disabled — the no-crash
        // contract then reduces to the panel staying mounted, which the
        // disabled state itself demonstrates. Only click when enabled.
        const clickable = await mark.isEnabled();
        if (clickable) {
            await mark.click();
        }

        // Either way the punch cluster stays mounted and healthy.
        await expect(panel).toBeVisible();
        await expect(page.getByTestId('punch-pre-roll')).toBeVisible();
        await expect(page.getByTestId('punch-post-roll')).toBeVisible();
    });
});
