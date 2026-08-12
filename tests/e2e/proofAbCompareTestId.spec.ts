import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof's A/B compare chip flips the mastering chain between the dry source (A)
// and the processed output (B). #1647 rewrote proofPanelTestId.spec.ts to assert
// only the device-add contract and dropped the A/B toggle coverage this restores.
// The chip's label swaps between "B / wet" (default — listening to the processed
// master) and "A / dry" (bypassed to the source) on each click, so the innerText
// change is the real compare-mode state flip, not a styling artifact.
test.describe('Proof A/B compare — toggle flips the wet/dry label', () => {
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

        // Open the panel by clicking the device card text.
        await inspector.getByText('Proof', { exact: false }).first().click();
        // Wait for a Proof-specific panel control to mount before asserting.
        await expect(page.getByRole('button', { name: /reset loudness/i })).toBeVisible({
            timeout: 15_000,
        });
    });

    test('clicking A/B compare flips the label from wet to dry', async ({ page }) => {
        const ab = page.getByRole('button', { name: 'A/B compare' });

        // Default mode is B (wet) — listening to the processed master.
        const before = await ab.innerText();
        expect(before.toLowerCase()).toContain('b');

        // Flip to A (dry) — the unprocessed source signal.
        await ab.click();
        await page.waitForTimeout(300);

        const after = await ab.innerText();
        expect(after.toLowerCase()).toContain('a');
        expect(after).not.toBe(before);
    });
});
