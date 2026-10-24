import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust's named detail tiers switch the panel's detail level. The active state
// flips (aria-pressed) on selection — a real state change. No E2E covers this;
// #1632 only asserts the device-add count delta.
test.describe('Crust level chips — switching detail level flips aria-pressed', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();

        // Open the panel.
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
        const detail = inspector.getByRole('group', { name: 'Effect control detail' });
        await expect(detail.getByRole('button', { name: 'play', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });

    test('selecting named detail tiers flips the active aria-pressed state', async ({ page }) => {
        const detail = page.getByRole('group', { name: 'Effect control detail' });
        const play = detail.getByRole('button', { name: 'play', exact: true });
        const shape = detail.getByRole('button', { name: 'shape', exact: true });
        const build = detail.getByRole('button', { name: 'build', exact: true });
        const route = detail.getByRole('button', { name: 'route', exact: true });
        const lab = detail.getByRole('button', { name: 'lab', exact: true });

        await expect(play).toHaveAttribute('aria-pressed', 'true');

        await shape.click();
        await expect(shape).toHaveAttribute('aria-pressed', 'true');
        await expect(play).not.toHaveAttribute('aria-pressed', 'true');

        await build.click();
        await expect(build).toHaveAttribute('aria-pressed', 'true');
        await expect(shape).not.toHaveAttribute('aria-pressed', 'true');

        await route.click();
        await expect(route).toHaveAttribute('aria-pressed', 'true');
        await expect(build).not.toHaveAttribute('aria-pressed', 'true');

        await lab.click();
        await expect(lab).toHaveAttribute('aria-pressed', 'true');
        await expect(route).not.toHaveAttribute('aria-pressed', 'true');

        await play.click();
        await expect(play).toHaveAttribute('aria-pressed', 'true');
        await expect(lab).not.toHaveAttribute('aria-pressed', 'true');
    });
});
