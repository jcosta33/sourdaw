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

// Grand Boule's physical-modeling knobs (Master gain, Board send, Sympathetic
// send, Stretch tuning, attack Bite) shape the piano sound. Existing specs
// cover the temperament selector and the Touch velocity-curve knob; the
// body/realism knobs were unaddressed — and, like Toaster's per-pad knobs,
// announced as "Parameter control" because the local Knob wrapper did not pass
// its label as an accessible name. That wrapper now forwards aria-label, so
// each knob is addressable by name.
test.describe('Grand Boule physical-model knobs — value changes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_grand_boule_panel(page);
    });

    test('the Master gain knob responds to keyboard', async ({ page }) => {
        const master = page.getByRole('slider', { name: 'Master' });
        await expect(master).toBeVisible({ timeout: 5000 });
        await master.focus();
        const before = Number(await master.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await master.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('the Stretch tuning knob responds to keyboard', async ({ page }) => {
        const stretch = page.getByRole('slider', { name: 'Stretch' });
        await expect(stretch).toBeVisible({ timeout: 5000 });
        await stretch.focus();
        const before = Number(await stretch.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await stretch.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
