import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('levain');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Levain/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByRole('button', { name: /Close Levain/i }).first()).toBeVisible({ timeout: 15_000 });
}

// Levain instrument family filter depth. The family selector
// (aria-label="Filter instruments by family", a radiogroup of chips at
// LevainPanel.tsx:132) is uncovered — no E2E asserts selecting a family
// narrows the instrument list.
test.describe('Levain instrument family filter — selecting a family narrows list', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openLevain(page);
    });

    test('selecting the Brass family decreases the instrument count and All restores it', async ({
        page,
    }) => {
        const radiogroup = page.getByRole('radiogroup', { name: 'Filter instruments by family' });
        await expect(radiogroup).toBeVisible({ timeout: 10_000 });

        // Count instrument buttons before filtering.
        const instruments = page.locator('button.levain-window');
        await expect(instruments.first()).toBeVisible({ timeout: 5000 });
        const before = await instruments.count();
        expect(before).toBeGreaterThanOrEqual(2);

        // Pick a specific family (not "All").
        const brassChip = radiogroup.getByRole('radio', { name: 'Brass' });
        await brassChip.click();
        await expect(brassChip).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });

        // The list narrowed and every remaining instrument is Brass
        // (the family badge text is part of each button's text content).
        const after = await instruments.count();
        expect(after).toBeGreaterThan(0);
        expect(after).toBeLessThan(before);
        const remainingTexts = await instruments.allTextContents();
        expect(remainingTexts).toHaveLength(after);
        for (const text of remainingTexts) {
            expect(text).toContain('Brass');
        }

        // Selecting "All" back restores the full list.
        await radiogroup.getByRole('radio', { name: 'All' }).click();
        await page.waitForTimeout(500);
        const restored = await instruments.count();
        expect(restored).toBe(before);
    });
});
