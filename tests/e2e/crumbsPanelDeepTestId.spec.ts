import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openInstrument(page: import('@playwright/test').Page, name: string): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill(name.toLowerCase());
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: new RegExp(`^${name}`, 'i') }).first().click();
    await page.waitForTimeout(2000);
}

// The Crumbs mode chips live in the Sampler device panel. The transport's
// Record button shares the "Record" name, so mode chips are scoped to the
// panel that owns the "Close Sampler" button.
function modeChip(page: import('@playwright/test').Page, mode: string): import('@playwright/test').Locator {
    const closeBtn = page.getByRole('button', { name: 'Close Sampler' });
    // The panel container is the ancestor holding the close button; search its
    // subtree for the named chip.
    return closeBtn.locator('xpath=ancestor::div[3]').getByRole('button', { name: new RegExp(`^${mode}$`, 'i'), exact: true });
}

test.describe('Crumbs sampler panel — deep', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openInstrument(page, 'Crumbs');
    });

    test('default mode chip is pressed; switching modes flips aria-pressed', async ({ page }) => {
        // The five mode chips. Quick is the default-active one.
        const quick = modeChip(page, 'Quick');
        await expect(quick).toBeVisible({ timeout: 15_000 });
        await expect(quick).toHaveAttribute('aria-pressed', 'true');

        const drum = modeChip(page, 'Drum');
        await drum.click();
        await page.waitForTimeout(300);
        // Drum is now pressed; Quick no longer carries the pressed attribute.
        await expect(drum).toHaveAttribute('aria-pressed', 'true');
        await expect(quick).not.toHaveAttribute('aria-pressed', 'true');
    });

    test('cycling through all modes lands each as the sole pressed chip', async ({ page }) => {
        const modes = ['Slice', 'Warp', 'Record'];
        for (const mode of modes) {
            const chip = modeChip(page, mode);
            await chip.click();
            await page.waitForTimeout(300);
            await expect(chip).toHaveAttribute('aria-pressed', 'true');
        }
        // The last-selected (Record) stays pressed; the first (Quick) does not.
        await expect(modeChip(page, 'Record')).toHaveAttribute('aria-pressed', 'true');
        await expect(modeChip(page, 'Quick')).not.toHaveAttribute('aria-pressed', 'true');
    });

    test('panel mounts envelope knobs (sliders)', async ({ page }) => {
        // Wait for the panel to settle, then confirm parameter knobs rendered.
        await expect(modeChip(page, 'Quick')).toBeVisible({ timeout: 15_000 });
        const knobs = page.getByRole('slider');
        await expect(knobs.first()).toBeVisible({ timeout: 10_000 });
        expect(await knobs.count()).toBeGreaterThan(2);
    });
});
