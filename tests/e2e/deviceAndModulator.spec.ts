import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

async function open_dock_tab(page: import('@playwright/test').Page, tab_id: string): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
    const pressed = (await toggle.getAttribute('aria-pressed')) ?? '';
    if (!pressed.match(/true/i)) {
        await toggle.click();
    }
    await page.locator(`#bottom-dock-tab-${tab_id}`).click();
}

// ---------------------------------------------------------------------------
// Modulation matrix — the New Modulator form opens and closes (aria-expanded).
// ---------------------------------------------------------------------------

test.describe('Modulation matrix form', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await open_dock_tab(page, 'modulation');
    });

    test('New Modulator toggles the form open and closed', async ({ page }) => {
        const matrix = page.getByRole('region', { name: 'Modulation matrix' });
        const new_btn = matrix.getByRole('button', { name: 'New Modulator', exact: true });

        await expect(new_btn).toHaveAttribute('aria-expanded', 'false');
        await new_btn.click();
        await expect(new_btn).toHaveAttribute('aria-expanded', 'true');
        await expect(matrix.getByRole('textbox', { name: 'Modulator name' })).toBeVisible();
        await expect(matrix.getByRole('combobox', { name: 'Modulator kind' })).toBeVisible();

        // Closing the form removes the fields.
        await new_btn.click();
        await expect(new_btn).toHaveAttribute('aria-expanded', 'false');
        await expect(matrix.getByRole('textbox', { name: 'Modulator name' })).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Crust device — the limiter/saturator ships a full device + panel.
// ---------------------------------------------------------------------------

test.describe('Crust device — adds a real device and opens its panel', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Adding Crust creates a bypassable device card in the chain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();

        const devices_before = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await page.waitForTimeout(800);

        // Crust now ships — a Crust device card is added (count rises by one)
        // and its bypass toggle is present, where the old behavior rejected the
        // add with a not-implemented notification.
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        const devices_after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(devices_after).toBe(devices_before + 1);
    });
});

// ---------------------------------------------------------------------------
// Gluten device — adding it creates a bypassable device card in the chain.
// (Unlike Crust, Gluten is fully implemented.)
// ---------------------------------------------------------------------------

test.describe('Gluten device', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Adding Gluten creates a device card whose bypass toggle relabels on click', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Gluten$/ }).click();
        await page.waitForTimeout(800);

        // Initially not bypassed → button says "Bypass Gluten", pressed=false.
        const bypass = inspector.getByRole('button', { name: /^Bypass Gluten/i });
        await expect(bypass).toBeVisible();
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');

        await bypass.click();

        // After bypassing, the same button relabels to "Enable Gluten", pressed=true.
        const enable = inspector.getByRole('button', { name: /^Enable Gluten/i });
        await expect(enable).toBeVisible();
        await expect(enable).toHaveAttribute('aria-pressed', 'true');
        await expect(bypass).toHaveCount(0);
    });
});
