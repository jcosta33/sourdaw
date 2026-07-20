import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Control Surface — MIDI Learn', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('MIDI Learn starts idle on both track gain and pan', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();

        // Both controls' learn buttons render the same idle label/state before
        // any mapping exists.
        const idleButtons = inspector.getByRole('button', { name: 'MIDI Learn' });
        await expect(idleButtons).toHaveCount(2);
        for (const index of [0, 1]) {
            await expect(idleButtons.nth(index)).toHaveAttribute('aria-pressed', 'false');
        }
    });

    test('Starting MIDI Learn on gain enters the listening state and excludes pan', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gainLearn = inspector.getByRole('button', { name: 'MIDI Learn' }).first();

        await gainLearn.click();

        // The clicked button switches to the listening label/state...
        const listening = inspector.getByRole('button', { name: 'Listening for MIDI CC...' });
        await expect(listening).toHaveCount(1);
        await expect(listening).toHaveAttribute('aria-pressed', 'true');

        // ...and it is the only button in that state — pan's button is still idle.
        const stillIdle = inspector.getByRole('button', { name: 'MIDI Learn' });
        await expect(stillIdle).toHaveCount(1);
        await expect(stillIdle).toHaveAttribute('aria-pressed', 'false');
    });

    test('Starting MIDI Learn on pan cancels an in-progress learn on gain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gainLearn = inspector.getByRole('button', { name: 'MIDI Learn' }).first();

        await gainLearn.click();
        await expect(inspector.getByRole('button', { name: 'Listening for MIDI CC...' })).toHaveCount(1);

        // Starting a learn session on the other control (pan, now the sole
        // remaining "MIDI Learn"-labelled button) must replace the learning
        // target rather than stack it — only one control listens at a time.
        const panLearn = inspector.getByRole('button', { name: 'MIDI Learn' });
        await expect(panLearn).toHaveCount(1);
        await panLearn.click();

        const listeningNow = inspector.getByRole('button', { name: 'Listening for MIDI CC...' });
        await expect(listeningNow).toHaveCount(1);
        await expect(listeningNow).toHaveAttribute('aria-pressed', 'true');

        // Gain reverted to idle — the session moved, it didn't duplicate.
        const idleAgain = inspector.getByRole('button', { name: 'MIDI Learn' });
        await expect(idleAgain).toHaveCount(1);
        await expect(idleAgain).toHaveAttribute('aria-pressed', 'false');
    });

    test('Clicking the listening button again cancels MIDI Learn', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gainLearn = inspector.getByRole('button', { name: 'MIDI Learn' }).first();

        await gainLearn.click();
        const listening = inspector.getByRole('button', { name: 'Listening for MIDI CC...' });
        await expect(listening).toHaveCount(1);

        await listening.click();

        // Cancelling returns both controls to the idle, unmapped state.
        await expect(inspector.getByRole('button', { name: 'Listening for MIDI CC...' })).toHaveCount(0);
        const idleButtons = inspector.getByRole('button', { name: 'MIDI Learn' });
        await expect(idleButtons).toHaveCount(2);
        await expect(idleButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');
        await expect(idleButtons.nth(1)).toHaveAttribute('aria-pressed', 'false');
    });
});
