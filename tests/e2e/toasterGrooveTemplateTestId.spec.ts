import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const TEMPLATE_SELECT_LABEL = 'Pattern groove template';
const AMOUNT_SLIDER_LABEL = 'Pattern groove amount';
// The unassigned select is driven to the Straight builtin, not to '' — the
// panel treats straight timing as the always-available default assignment.
const DEFAULT_TEMPLATE_VALUE = 'groove-straight';
// Any non-default builtin works; MPC 60 Feel is a 1/16 template and the default
// pattern grid is 16 steps/bar, so the assignment lands in 'ready' state.
const TARGET_TEMPLATE_LABEL = 'MPC 60 Feel';
const TARGET_TEMPLATE_VALUE = 'mpc-60';

async function openToaster(page: Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    // The Toaster card must be reachable; if it is not, fail rather than skip.
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the first pad renders once ToasterPanel is up.
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

// The amount control is a native input[type=range]: its accessible value (the
// implicit aria-valuenow) lives on the element's value property, not on a DOM
// attribute, so read it with inputValue().
async function readAmountValue(page: Page): Promise<number> {
    const slider = page.getByLabel(AMOUNT_SLIDER_LABEL);
    return Number(await slider.inputValue());
}

// Same registration race as the kit knobs (toasterGrooveKitKnobsTestId.spec):
// a write that lands before the device is registered is dropped, not queued —
// and here a dropped commit also clears the local preview, snapping the slider
// back to its previous value. Retry the nudge until the store round-trip holds
// the moved value. Stops at the first effective press, so single-step
// arithmetic still holds. Returns the settled value for the caller to assert.
async function nudgeAmountUntil(
    page: Page,
    key: 'ArrowUp' | 'ArrowDown',
    hasMoved: (value: number) => boolean
): Promise<number> {
    const slider = page.getByLabel(AMOUNT_SLIDER_LABEL);
    await slider.focus();
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.keyboard.press(key);
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
            const value = await readAmountValue(page);
            if (hasMoved(value)) {
                return value;
            }
            await page.waitForTimeout(100);
        }
    }
    return readAmountValue(page);
}

// Toaster's Groove section offers a template combobox plus an amount slider,
// both gated by canAssignGroove (an active pattern with resolvable groove
// state). Assigning a template through the combobox had no E2E coverage.
//
// The amount slider is direction-default-dependent: an assignment made from the
// combobox carries amount 1 (the panel's default), so the slider starts at its
// max of 1 and only ArrowDown can move it.
test.describe('Toaster Groove template — assign a groove template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('selecting a groove template changes the combobox and enables the amount slider', async ({ page }) => {
        const select = page.getByLabel(TEMPLATE_SELECT_LABEL);
        await expect(select).toBeVisible({ timeout: 10_000 });

        // Pin the starting value so a default change cannot silently flip the
        // test's premise: the combobox opens on the Straight builtin.
        await expect(select).toHaveValue(DEFAULT_TEMPLATE_VALUE, { timeout: 10_000 });
        // The combobox must be interactive for the assignment path to exist.
        await expect(select).toBeEnabled();

        // Controlled select: the DOM value only sticks once the assignment
        // round-trips through the groove template store, so poll via toHaveValue.
        await select.selectOption({ label: TARGET_TEMPLATE_LABEL });
        await expect(select).toHaveValue(TARGET_TEMPLATE_VALUE, { timeout: 10_000 });

        // With a groove assigned, the amount slider is enabled.
        const amount = page.getByLabel(AMOUNT_SLIDER_LABEL);
        await expect(amount).toBeVisible();
        await expect(amount).toBeEnabled();

        // A fresh assignment carries the default amount of 1 (slider max), so
        // ArrowDown is the only direction that can move it. Step is 0.01.
        expect(await readAmountValue(page)).toBe(1);
        const after = await nudgeAmountUntil(page, 'ArrowDown', (value) => value < 1);
        expect(after).toBe(0.99);
    });
});
