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

// Grand Boule's Morph panel (§3.1) was the only device sub-panel with no E2E
// cover: its enable DawPluginToggle and the Morph/Balance knobs. The MorphKnob
// wrapper in MorphPanel does not forward its label as an accessible name, so
// both knobs resolve to the rotary's fallback accessible name "Parameter
// control" — disambiguated positionally (.first() = Morph). The enable toggle
// shares its OFF/ON text with the Una corda and Sostenuto pedal toggles, so it
// is anchored on its unique "Enable morph" sibling label.
test.describe('Grand Boule Morph panel — enable toggle + morph knob', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_grand_boule_panel(page);
    });

    test('the morph enable toggle flips aria-pressed off → on', async ({ page }) => {
        // "Enable morph" is the unique label adjacent to the morph toggle; its
        // only sibling button is the DawPluginToggle.
        const morphToggle = page
            .getByText('Enable morph', { exact: true })
            .locator('xpath=following-sibling::button');

        // Default state: morph disabled → aria-pressed="false", label "OFF".
        await expect(morphToggle).toHaveAttribute('aria-pressed', 'false');
        await expect(morphToggle).toHaveText('OFF');

        // Toggle on.
        await morphToggle.click();
        await expect(morphToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(morphToggle).toHaveText('ON');

        // Round-trip back off to confirm it is a real flip, not a one-shot.
        await morphToggle.click();
        await expect(morphToggle).toHaveAttribute('aria-pressed', 'false');
        await expect(morphToggle).toHaveText('OFF');
    });

    test('the morph position knob increases via ArrowUp', async ({ page }) => {
        // Enable morph so the knob is exercised in its intended active state.
        const morphToggle = page
            .getByText('Enable morph', { exact: true })
            .locator('xpath=following-sibling::button');
        await morphToggle.click();
        await expect(morphToggle).toHaveAttribute('aria-pressed', 'true');

        // Both Morph and Balance knobs announce as "Parameter control" because
        // MorphPanel's MorphKnob wrapper does not forward an aria-label. The
        // Morph knob is the first of the two in DOM order.
        const morphKnob = page.getByRole('slider', { name: 'Parameter control' }).first();
        await expect(morphKnob).toBeVisible({ timeout: 5000 });

        await morphKnob.focus();
        const before = Number(await morphKnob.getAttribute('aria-valuenow'));
        // morphPosition defaults to 0.0, so `before` is 0 here; ArrowUp nudges
        // it one step (0.01) within the 0..1 range.
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await morphKnob.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
