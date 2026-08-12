import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function open_grand_boule_panel(page: import('@playwright/test').Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const grandBouleCard = browser.getByRole('button', { name: 'Grand Boule' });
    await grandBouleCard.waitFor({ state: 'visible' });
    await grandBouleCard.click();
    // Panel-mounted contract: the Close control appears once the panel renders.
    await expect(page.getByRole('button', { name: 'Close Grand Boule' })).toBeVisible({ timeout: 15_000 });
}

// The Grand Boule "Mix" section carries the soundboard and sympathetic-resonance
// send knobs ("Board" and "Symp"). These were unaddressed by the existing
// physical-model knob specs (Master gain and Stretch tuning); both are now
// addressable by accessible name thanks to the Knob wrapper forwarding its
// label as aria-label.
test.describe('Grand Boule Board + Symp send knobs — value changes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_grand_boule_panel(page);
    });

    test('the Board (soundboard send) knob responds to keyboard', async ({ page }) => {
        const board = page.getByRole('slider', { name: 'Board' });
        await expect(board).toBeVisible({ timeout: 5000 });
        await board.focus();
        const before = Number(await board.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await board.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('the Symp (sympathetic send) knob responds to keyboard', async ({ page }) => {
        const symp = page.getByRole('slider', { name: 'Symp' });
        await expect(symp).toBeVisible({ timeout: 5000 });
        await symp.focus();
        const before = Number(await symp.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await symp.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
