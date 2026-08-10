import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

/**
 * Dutch Oven is the ProofChamber algorithmic reverb (`dutch-oven`). Adding it
 * via the inspector's "Add device" menu creates a real device card whose panel
 * (`ProofChamberPanel`) mounts always-rendered Core knobs — Size, Decay, Mix,
 * Pre — each a `role="slider"` with `aria-label={label}` and `aria-valuenow`.
 *
 * The existing `devicePanelAllTestId.spec.ts:84` only checks the card exists;
 * this spec asserts a state change: the bypass count rises by one, and a Core
 * knob's `aria-valuenow` moves on ArrowUp.
 */
test.describe('ProofChamber (Dutch Oven) panel — add device and drive a knob', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Adding Dutch Oven creates a bypassable device card whose panel knob responds to ArrowUp', async ({
        page,
    }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();

        const devices_before = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        await page.getByRole('menuitem', { name: /^Dutch Oven$/ }).click();
        await page.waitForTimeout(800);

        // The add mounts a Dutch Oven device card: the Bypass-button count
        // rises by one and a `Bypass Dutch Oven` toggle appears — the same
        // contract the rewritten Crust test asserts.
        await expect(inspector.getByRole('button', { name: /^Bypass Dutch Oven$/i })).toBeVisible();
        const devices_after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(devices_after).toBe(devices_before + 1);

        // Open the ProofChamber panel by clicking the device card. Dutch Oven
        // declares `hasCustomUI`, so the card routes through
        // `showDevicePanelForType` and mounts `ProofChamberPanel`. The always-
        // rendered Core "Size" knob is the panel-mounted signal.
        await inspector.getByText('Dutch Oven', { exact: false }).first().click();
        const sizeKnob = page.getByRole('slider', { name: 'Size' }).first();
        await expect(sizeKnob).toBeVisible({ timeout: 10_000 });

        // Focus the knob, press ArrowUp, and assert aria-valuenow increases —
        // the same state-change pattern as deviceKnobKeyboardTestId.spec.ts:31.
        await sizeKnob.focus();
        const before = Number(await sizeKnob.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await sizeKnob.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
