import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openTab(page: Page, tabId: string): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
    const tab = page.locator(`#bottom-dock-tab-${tabId}`);
    if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(500);
    }
}

/**
 * Drives the record button until the slot holds `layers` layers. Each cycle is
 * gated on the slot's own state label / layer-count readout, so the helper
 * never races the store update: empty -> Rec -> Play (1L), then per extra
 * layer Play -> Dub -> Play (nL).
 */
async function recordLayers(page: Page, layers: number): Promise<void> {
    const region = page.getByRole('region', { name: 'Loop station' });
    await region.getByRole('button', { name: 'Create loop slot row 1' }).first().click();

    const record = region.getByRole('button', { name: 'Record or overdub slot 1' });
    await record.click();
    await expect(region.getByText('Rec', { exact: true })).toBeVisible();
    await record.click();
    await expect(region.getByText('1L')).toBeVisible();

    for (let layer = 2; layer <= layers; layer += 1) {
        await record.click();
        await expect(region.getByText('Dub', { exact: true })).toBeVisible();
        await record.click();
        await expect(region.getByText(`${layer}L`)).toBeVisible();
    }
}

test.describe('Loop station slot buttons — stop/play/undo/clear per slot', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: 'EDM' });
        await openTab(page, 'loopStation');
    });

    test('stop slot then play slot flip the slot state label', async ({ page }) => {
        const region = page.getByRole('region', { name: 'Loop station' });
        await recordLayers(page, 1);
        await expect(region.getByText('Play', { exact: true })).toBeVisible();

        // stopSlot maps playing -> stopped; the state label is the observable.
        await region.getByRole('button', { name: 'Stop slot 1' }).click();
        await expect(region.getByText('Stop', { exact: true })).toBeVisible();
        await expect(region.getByText('Play', { exact: true })).toHaveCount(0);

        // triggerSlot maps stopped -> playing for a slot with content.
        await region.getByRole('button', { name: 'Play slot 1' }).click();
        await expect(region.getByText('Play', { exact: true })).toBeVisible();
        await expect(region.getByText('Stop', { exact: true })).toHaveCount(0);
    });

    test('undo last layer reduces the count and empties the slot at zero', async ({ page }) => {
        const region = page.getByRole('region', { name: 'Loop station' });
        await recordLayers(page, 2);
        await expect(region.getByText('2L')).toBeVisible();

        const undo = region.getByRole('button', { name: 'Undo last layer on slot 1' });

        // 2 layers -> 1: state stays playing, only the count readout drops.
        await undo.click();
        await expect(region.getByText('1L')).toBeVisible();
        await expect(region.getByText('2L')).toHaveCount(0);
        await expect(region.getByText('Play', { exact: true })).toBeVisible();

        // 1 layer -> 0: undoLastLayer forces the slot back to empty.
        await undo.click();
        await expect(region.getByText('Empty', { exact: true })).toBeVisible();
        await expect(region.getByText('0L')).toBeVisible();

        // With zero layers the gated buttons (Play, Undo) disable — the undo
        // landed in the store, not just in the label.
        await expect(region.getByRole('button', { name: 'Play slot 1' })).toBeDisabled();
        await expect(undo).toBeDisabled();
    });

    test('clear slot resets the slot to empty and disables gated buttons', async ({ page }) => {
        const region = page.getByRole('region', { name: 'Loop station' });
        await recordLayers(page, 1);
        await expect(region.getByText('Play', { exact: true })).toBeVisible();

        await region.getByRole('button', { name: 'Clear slot 1' }).click();
        await expect(region.getByText('Empty', { exact: true })).toBeVisible();
        await expect(region.getByText('0L')).toBeVisible();
        await expect(region.getByText('1L')).toHaveCount(0);

        // clearSlot wipes layers[], so the layer-gated controls disable.
        await expect(region.getByRole('button', { name: 'Play slot 1' })).toBeDisabled();
        await expect(region.getByRole('button', { name: 'Undo last layer on slot 1' })).toBeDisabled();
    });
});

test.describe('Session view — stop all clips', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);

        // The session grid only enables slots whose track holds a clip, and a
        // fresh project has none (the EDM template's arrangement clips do not
        // surface in the session grid either). Add a MIDI track with one clip
        // so a slot is launchable: command palette → right-click timeline →
        // "Add Clip Here" (same recipe as clipInspectorControls.spec.ts).
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);

        await openTab(page, 'session');
    });

    test('stop all clips deactivates a launched slot', async ({ page }) => {
        const stopAll = page.getByRole('button', { name: 'Stop all clips' });
        await expect(stopAll).toBeVisible();

        // Only slots with a clip are enabled; a click toggles that track's
        // active slot. The launched state renders a Play icon inside the slot
        // button (conditional render, not styling).
        const slot = page.getByRole('button', { name: / - clip loaded$/ }).first();
        await expect(slot).toBeEnabled();
        await slot.click();
        await expect(slot.locator('svg')).toHaveCount(1);

        // stopAllSessionSlots clears every active slot — the icon disappears.
        await stopAll.click();
        await expect(slot.locator('svg')).toHaveCount(0);

        // No crash: the workspace is still interactive.
        await expect(page.getByTestId('transport-play')).toBeVisible();
    });
});
