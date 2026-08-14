import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('levain');
    await page.waitForTimeout(500);
    // The Levain card must be reachable; if it is not, the panel-open contract
    // is broken and the test must fail rather than silently skip.
    const card = page.getByRole('button', { name: /^Levain/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: wait on the Close control instead of a fixed delay.
    await expect(page.getByRole('button', { name: /Close Levain/i }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Levain articulation & instrument panel', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Levain close button hides the panel', async ({ page }) => {
        await openLevain(page);
        const close = page.getByRole('button', { name: /Close Levain/i }).first();
        await close.click();
        // Closing unmounts the panel — the Close control is gone.
        await expect(close).toHaveCount(0);
    });

    test('Levain knob responds to keyboard — aria-valuenow changes on ArrowUp', async ({ page }) => {
        await openLevain(page);
        const firstSlider = page.getByRole('slider').first();
        await expect(firstSlider).toBeVisible({ timeout: 5000 });
        await firstSlider.focus();
        const before = Number(await firstSlider.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await firstSlider.getAttribute('aria-valuenow'));
        if (before < 1) {
            expect(after).toBeGreaterThan(before);
        }
    });

    test('selecting another articulation moves aria-pressed to the new chip', async ({ page }) => {
        test.setTimeout(120000);
        await openLevain(page);

        // Scope to the articulation rail: the only section whose text includes
        // its heading. Instrument rows, family filters, and the Desk toggles
        // live in other sections, so every button inside is an articulation
        // chip. DawPluginChip sets aria-pressed="true" when active and omits
        // the attribute entirely when not, so the pressed selector is unique
        // to the current articulation.
        const rail = page.locator('section', { hasText: 'Articulation rail' });
        await expect(rail).toBeVisible({ timeout: 10_000 });

        const chips = rail.getByRole('button');
        await expect(chips.first()).toBeVisible();
        expect(await chips.count()).toBeGreaterThanOrEqual(2);

        const activeChips = rail.locator('button[aria-pressed="true"]');
        await expect(activeChips).toHaveCount(1);

        // Default patch is violin-1 (strings) with currentArticulation
        // 'sustain', whose display name is "Long" — the first chip.
        const defaultChip = chips.first();
        await expect(defaultChip).toContainText('Long');
        await expect(defaultChip).toHaveAttribute('aria-pressed', 'true');

        // A different articulation from the same strings set. "Staccato"
        // matches exactly one chip ('staccatissimo' is not in the strings
        // default set).
        const staccato = chips.filter({ hasText: 'Staccato' });
        await expect(staccato).toHaveCount(1);
        await staccato.click();

        // The new chip is pressed, the prior one is not, and exactly one
        // pressed chip remains — the selection moved, it did not stack.
        await expect(staccato).toHaveAttribute('aria-pressed', 'true');
        await expect(defaultChip).not.toHaveAttribute('aria-pressed', 'true');
        await expect(activeChips).toHaveCount(1);
        await expect(activeChips.first()).toContainText('Staccato');
    });
});
