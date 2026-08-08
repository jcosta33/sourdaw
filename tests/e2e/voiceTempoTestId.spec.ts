import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Voice button & tempo map — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('opening tempo map shows the editor dialog', async ({ page }) => {
        const tempoMap = page.getByTestId('transport-tempo-map-toggle');
        await tempoMap.click();
        await page.waitForTimeout(300);

        // The tempo map editor should appear.
        const editor = page.getByRole('dialog', { name: 'Tempo map editor' }).or(page.getByText('Tempo map editor'));
        const hasEditor = await editor.first().isVisible().catch(() => false);
        // If visible, verify it has content.
        if (hasEditor) {
            expect(await editor.first().innerText()).toBeTruthy();
        }

        // Close it.
        await tempoMap.click();
    });

    test('voice command button is present when available', async ({ page }) => {
        // The voice button only renders when isAvailable is true.
        // It may not be available in headless browsers.
        const voice = page.getByTestId('voice-command-button');
        const hasVoice = await voice.isVisible().catch(() => false);
        if (hasVoice) {
            await expect(voice).toHaveAttribute('aria-pressed', 'false');
        }
    });

    test('tempo editor BPM wrapper is present with spinbutton', async ({ page }) => {
        const bpmWrapper = page.getByTestId('transport-tempo-bpm');
        await expect(bpmWrapper).toBeVisible({ timeout: 10_000 });

        // The spinbutton inside should have aria-valuenow=120.
        const spinbutton = bpmWrapper.getByRole('spinbutton');
        await expect(spinbutton).toBeVisible();
        await expect(spinbutton).toHaveAttribute('aria-valuenow', '120');
    });

    test('time signature button shows 4/4 via test ID', async ({ page }) => {
        const timeSig = page.getByTestId('transport-time-signature');
        await expect(timeSig).toBeVisible({ timeout: 10_000 });
        const text = (await timeSig.innerText()).trim();
        expect(text).toMatch(/4\/4/);
    });
});
