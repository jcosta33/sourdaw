import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Proof is a mastering effect added via the inspector Add-device menu on a
// track. The previous version of this spec opened the panel via browser search
// (Proof is not in the browser) and silently skipped every assertion behind
// `if (await …isVisible())` guards, so a regression that broke the add flow
// turned the tests into no-ops. This version asserts the real add state change
// directly: the Bypass-button count rises by one and a `Bypass Proof` toggle
// appears — the same contract the rewritten Crust/Dutch Oven tests assert.
test.describe('Proof device — add to chain', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Adding Proof creates a bypassable device card in the chain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const devices_before = await inspector.getByRole('button', { name: /^Bypass /i }).count();

        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();

        // A Proof device card is added — count rises by one and the bypass
        // toggle is present, where the panel-open guards used to hide a failure.
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();
        const devices_after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(devices_after).toBe(devices_before + 1);
    });

    test('shared named tiers retain the earlier controls and their settings', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();
        await inspector.getByText('Proof', { exact: false }).first().click();

        const selector = page.getByRole('group', { name: 'Effect control detail' });
        await expect(selector).toBeVisible();
        await expect(selector.getByRole('button', { name: 'play', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        const ceiling = page.getByRole('slider', { name: 'Mission limiter ceiling', exact: true });
        await expect(ceiling).toBeVisible();
        const before = await ceiling.getAttribute('aria-valuenow');
        if (before === null) {
            throw new Error('Proof mission ceiling has no current value');
        }

        for (const [selected, tier] of ['play', 'shape', 'build', 'route', 'lab'].entries()) {
            await selector.getByRole('button', { name: tier, exact: true }).click();
            await expect(selector.getByRole('button', { name: tier, exact: true })).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            for (const [floor, name] of ['Play', 'Shape', 'Build', 'Route', 'Lab'].entries()) {
                await expect(page.getByRole('region', { name: `${name} controls`, exact: true })).toHaveCount(
                    floor <= selected ? 1 : 0
                );
            }
            await expect(ceiling).toHaveAttribute('aria-valuenow', before);
        }
        await selector.getByRole('button', { name: 'play', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Build controls', exact: true })).toHaveCount(0);
        await expect(ceiling).toHaveAttribute('aria-valuenow', before);
    });
});
