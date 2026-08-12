import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Opens the Grand Boule piano panel from the Browser panel's Instruments tab.
 * Grand Boule is a "House Special" instrument card: clicking it creates a MIDI
 * track, attaches the device, and opens the panel in one step (see
 * grandBoule.spec.ts).
 */
async function open_grand_boule_panel(page: import('@playwright/test').Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const grandBouleCard = browser.getByRole('button', { name: 'Grand Boule' });
    await grandBouleCard.waitFor({ state: 'visible' });
    await grandBouleCard.click();
    // Panel-mounted contract: the Close control appears once the panel renders.
    await expect(page.getByRole('button', { name: 'Close Grand Boule' })).toBeVisible({ timeout: 15_000 });
}

/**
 * Scopes to the "Pedals" DawPluginSectionCard. `DawPluginSectionCard` renders a
 * `<section>`, and `hasText` tests the regex against the section's *entire*
 * text content (all child text), so the regex must be unanchored — `^Pedals$`
 * would require the whole card to read "Pedals" and match nothing. Unanchored
 * `/Pedals/` is still unique on the panel: the middle column `<section>` holds
 * "Grand Boule" / "Physical Modeling Piano", and no other card title contains
 * the word.
 *
 * The two binary pedals (Una corda, Sostenuto) render as `DawPluginToggle`
 * chips that show the bare text "OFF"/"ON" — the same text the Morph panel's
 * "Enable morph" toggle shows. They are therefore indistinguishable by role+name
 * alone. Each toggle's row pairs a `<span>` label with the chip as a sibling
 * `<button>`, so the toggle is addressed via the label span's
 * `following-sibling::button`. The span labels are anchored (`^…$`) because
 * they are the span's exact text, which also disambiguates from the lowercase
 * "una corda"/"sostenuto" inside the Pedals detail line.
 */
function pedals_section(page: import('@playwright/test').Page) {
    return page.locator('section').filter({ hasText: /Pedals/ });
}

function pedal_toggle(page: import('@playwright/test').Page, label: string) {
    return pedals_section(page)
        .locator('span', { hasText: new RegExp(`^${label}$`) })
        .locator('xpath=following-sibling::button');
}

test.describe('Grand Boule pedals — binary toggle aria-pressed round-trip', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_grand_boule_panel(page);
    });

    test('the Una corda pedal toggles aria-pressed on then off', async ({ page }) => {
        const unaCorda = pedal_toggle(page, 'Una corda');
        await expect(unaCorda).toBeVisible({ timeout: 5000 });

        // Default: unaCorda is off (false) → aria-pressed is "false".
        await expect(unaCorda).toHaveAttribute('aria-pressed', 'false');

        // Toggle on.
        await unaCorda.click();
        await expect(unaCorda).toHaveAttribute('aria-pressed', 'true');

        // Toggle back off (round-trip).
        await unaCorda.click();
        await expect(unaCorda).toHaveAttribute('aria-pressed', 'false');
    });

    test('the Sostenuto pedal toggles aria-pressed on then off', async ({ page }) => {
        const sostenuto = pedal_toggle(page, 'Sostenuto');
        await expect(sostenuto).toBeVisible({ timeout: 5000 });

        // Default: sostenuto is off (false) → aria-pressed is "false".
        await expect(sostenuto).toHaveAttribute('aria-pressed', 'false');

        // Toggle on.
        await sostenuto.click();
        await expect(sostenuto).toHaveAttribute('aria-pressed', 'true');

        // Toggle back off (round-trip).
        await sostenuto.click();
        await expect(sostenuto).toHaveAttribute('aria-pressed', 'false');
    });

    test('toggling one pedal does not flip the other', async ({ page }) => {
        const unaCorda = pedal_toggle(page, 'Una corda');
        const sostenuto = pedal_toggle(page, 'Sostenuto');

        // Both start off.
        await expect(unaCorda).toHaveAttribute('aria-pressed', 'false');
        await expect(sostenuto).toHaveAttribute('aria-pressed', 'false');

        // Engage Una corda only — Sostenuto must remain off.
        await unaCorda.click();
        await expect(unaCorda).toHaveAttribute('aria-pressed', 'true');
        await expect(sostenuto).toHaveAttribute('aria-pressed', 'false');

        // Engage Sostenuto too — both now on, independently.
        await sostenuto.click();
        await expect(unaCorda).toHaveAttribute('aria-pressed', 'true');
        await expect(sostenuto).toHaveAttribute('aria-pressed', 'true');

        // Disengage Una corda only — Sostenuto stays engaged.
        await unaCorda.click();
        await expect(unaCorda).toHaveAttribute('aria-pressed', 'false');
        await expect(sostenuto).toHaveAttribute('aria-pressed', 'true');
    });
});
