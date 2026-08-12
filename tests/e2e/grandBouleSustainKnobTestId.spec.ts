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

// Grand Boule's body and pedal knobs were unaddressed by the existing specs
// (temperament + Touch/Curve knob, and the physical-model Master + Stretch
// knobs). Like Toaster's per-pad knobs, these were announced as "Parameter
// control" because the local Knob wrapper did not pass its label as an
// accessible name. That wrapper now forwards aria-label (#1666), so each knob
// is addressable by name. The Sustain pedal knob and the Board soundboard-send
// knob are the remaining uncovered body/realism controls that respond to the
// keyboard.
test.describe('Grand Boule sustain + board knobs — value changes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_grand_boule_panel(page);
    });

    test('the Sustain pedal knob responds to keyboard', async ({ page }) => {
        const sustain = page.getByRole('slider', { name: 'Sustain' });
        await expect(sustain).toBeVisible({ timeout: 5000 });
        await sustain.focus();
        const before = Number(await sustain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await sustain.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('the Board soundboard-send knob responds to keyboard', async ({ page }) => {
        const board = page.getByRole('slider', { name: 'Board' });
        await expect(board).toBeVisible({ timeout: 5000 });
        await board.focus();
        const before = Number(await board.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await board.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
