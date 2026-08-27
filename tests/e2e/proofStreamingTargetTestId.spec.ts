import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof mastering "Mission" rail offers one DawPluginChip per loudness target
// (Streaming, CD, Club / DJ, Broadcast, Podcast); the "Quick read" SideCard
// mirrors the active target in its "Target" readout row. No E2E covers picking
// a different target in Proof — Crust's streaming-target is covered by #1709,
// but Proof's selector and readout are a separate module. This asserts that
// selecting a target chip flips the chip's aria-pressed AND changes the Target
// readout, the contract a user relies on to know the desk retargeted.
test.describe('Proof streaming-loudness target — selection changes Target readout', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();
        await inspector.getByText('Proof', { exact: false }).first().click();
        await expect(page.getByRole('slider', { name: 'Master limiter ceiling' })).toBeVisible({
            timeout: 15_000,
        });
    });

    test('selecting a different target flips aria-pressed and updates the Target readout', async ({ page }) => {
        // The "Target" label is ambiguous elsewhere in the panel (the Level 1
        // header and the "Play" level-option detail both read "Target"), so
        // scope to the "Quick read" SideCard — its readout list is the only
        // place the label pairs with its value span.
        const quickRead = page.locator('section').filter({ hasText: 'Quick read' });
        const targetReadout = quickRead.getByText('Target', { exact: true }).locator('xpath=following-sibling::span');

        // Default patch targets "Streaming"; its chip is the active one.
        await expect(targetReadout).toHaveText('Streaming');
        const streamingChip = page.getByRole('button', { name: 'Streaming', exact: true });
        await expect(streamingChip).toHaveAttribute('aria-pressed', 'true');

        // Pick a different target — "Club / DJ".
        const clubChip = page.getByRole('button', { name: 'Club / DJ', exact: true });
        await clubChip.scrollIntoViewIfNeeded();
        // The chip must own its visible center; a later rail section used to
        // overlap this point and intercept every normal click.
        const chipOwnsHitTarget = await clubChip.evaluate((chip) => {
            const rect = chip.getBoundingClientRect();
            const x = rect.x + rect.width / 2;
            const y = rect.y + rect.height / 2;
            const topHit = document.elementFromPoint(x, y);
            return topHit !== null && chip.contains(topHit);
        });
        expect(chipOwnsHitTarget).toBe(true);
        await clubChip.click();

        // The selector state and the readout both reflect the new target.
        await expect(clubChip).toHaveAttribute('aria-pressed', 'true');
        await expect(streamingChip).not.toHaveAttribute('aria-pressed', 'true');
        await expect(targetReadout).toHaveText('Club / DJ');
    });
});
