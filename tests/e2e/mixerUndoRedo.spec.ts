import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Mixer mutations assert their writes but none assert undo integrity: the
// mutationUndoRedo round-trip exists for track/device/clip/AI/automation
// classes only. Gain and pan writes route through executeAppAction
// (useChannelStripActions commitGesture), so each must restore under
// transport-undo and re-apply under redo. One keyboard step per mutation —
// each step is its own undo entry, so single steps keep the round-trip
// exact.
//
// Send undo is NOT covered here: send writes bypass the action boundary
// (SendsSection/SendsEditor call the raw setSend use case) and cannot be
// routed through it today — the setSend action is edit-only (its handler
// conflicts when no send exists) and setSend has no transient mode to
// serve per-tick display writes. See ledger #1635 for the evidence chain;
// the gap needs an action-side design (create-capable action or transient
// mode), not a view workaround.
test.describe('Mixer mutation undo/redo round-trips', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await wait_for_workspace_ready(page);
        const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
        if (!/true/i.test((await dock.getAttribute('aria-pressed')) ?? '')) {
            await dock.click();
        }
        await page.waitForTimeout(500);
        await page.locator('#bottom-dock-tab-mixer').click();
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible({ timeout: 5000 });
    });

    test('channel gain: undo restores, redo re-applies', async ({ page }) => {
        const firstChannel = page.getByRole('region', { name: 'Mixer panel' }).getByRole('group', { name: /channel/i }).first();
        const gain = firstChannel.getByRole('slider', { name: /gain/i });
        await expect(gain).toBeAttached({ timeout: 5000 });
        const baseline = Number(await gain.getAttribute('aria-valuenow'));

        await gain.focus();
        await page.keyboard.press('ArrowUp');
        const moved = Number(await gain.getAttribute('aria-valuenow'));
        expect(moved).toBeGreaterThan(baseline);

        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled({ timeout: 10_000 });
        await undo.click();
        await expect(gain).toHaveAttribute('aria-valuenow', String(baseline), { timeout: 10_000 });

        await page.getByTestId('transport-redo').click();
        await expect(gain).toHaveAttribute('aria-valuenow', String(moved), { timeout: 10_000 });
    });

    test('channel pan: undo restores, redo re-applies', async ({ page }) => {
        const firstChannel = page.getByRole('region', { name: 'Mixer panel' }).getByRole('group', { name: /channel/i }).first();
        const pan = firstChannel.getByRole('slider', { name: /pan$/i });
        await expect(pan).toBeAttached({ timeout: 5000 });
        const baseline = Number(await pan.getAttribute('aria-valuenow'));

        await pan.focus();
        await page.keyboard.press('ArrowRight');
        const moved = Number(await pan.getAttribute('aria-valuenow'));
        expect(moved).not.toBe(baseline);

        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled({ timeout: 10_000 });
        await undo.click();
        await expect(pan).toHaveAttribute('aria-valuenow', String(baseline), { timeout: 10_000 });

        await page.getByTestId('transport-redo').click();
        await expect(pan).toHaveAttribute('aria-valuenow', String(moved), { timeout: 10_000 });
    });
});
