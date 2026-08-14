import { test, expect, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { launch_new_project } from './e2eUtils';

/**
 * Resilient workspace setup. Mirrors e2eUtils.setupWorkspace (same onboarding /
 * alpha-notice localStorage flags) but navigates with `domcontentloaded` instead
 * of the default `load`: in dev mode the `load` event can hang on first-run
 * worker compilation, while the app is fully interactive after DOM ready. The
 * element-based `launch_new_project` readiness gate is unchanged.
 */
async function setup_workspace_dom_ready(page: Page): Promise<void> {
    const alphaDismissed = superjsonStringify(true);

    await page.addInitScript((flag) => {
        window.localStorage.clear();
        window.localStorage.setItem('wd:onboarding-completed', '1');
        window.localStorage.setItem('sourdaw-alpha-notice-dismissed', flag);
    }, alphaDismissed);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
}

/**
 * Runs a command from the command palette by its exact label. Mirrors the
 * palette idiom proven in commandPalette.spec.ts: open with Cmd/Ctrl+K, type
 * the label, then invoke the matching option and wait for the palette to close.
 */
async function run_palette_command(page: Page, label: string): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

    const palette = page.getByRole('dialog', { name: /Command Palette/i });
    await expect(palette).toBeVisible();

    const input = palette.getByPlaceholder(/Type a command/i);
    await expect(input).toBeFocused();
    await input.fill(label);

    const option = palette.getByRole('option', { name: new RegExp(label, 'i') }).first();
    await expect(option).toBeVisible();
    await option.click();

    await expect(palette).not.toBeVisible();
}

test.describe('Monitoring status indicators', () => {
    test.beforeEach(async ({ page }) => {
        await setup_workspace_dom_ready(page);
        await launch_new_project(page);
    });

    test('Control-room mono/dim commands surface a live status-bar badge', async ({ page }) => {
        const statusBar = page.getByRole('contentinfo', { name: 'Application status' });

        // Invisibility evidence: nothing reflects monitoring state before the command runs.
        await expect(statusBar.getByLabel(/^Monitoring:/)).toHaveCount(0);

        await run_palette_command(page, 'Toggle Mono Monitoring');
        const monoBadge = statusBar.getByLabel('Monitoring: Mono active');
        await expect(monoBadge).toBeVisible();
        await expect(monoBadge).toHaveText('Mono');

        await run_palette_command(page, 'Toggle Dim Monitoring');
        const bothBadge = statusBar.getByLabel('Monitoring: Mono · Dim active');
        await expect(bothBadge).toBeVisible();
        await expect(bothBadge).toHaveText('Mono · Dim');

        // Toggling mono back off must leave only the dim reflection.
        await run_palette_command(page, 'Toggle Mono Monitoring');
        const dimBadge = statusBar.getByLabel('Monitoring: Dim active');
        await expect(dimBadge).toBeVisible();
        await expect(dimBadge).toHaveText('Dim');
    });

    test('Adding CV/Gate outputs surfaces a status-bar badge with a live count', async ({ page }) => {
        const statusBar = page.getByRole('contentinfo', { name: 'Application status' });

        // Invisibility evidence: no CV/Gate reflection before any output is added.
        await expect(statusBar.getByLabel(/CV\/Gate output/)).toHaveCount(0);

        await run_palette_command(page, 'Add CV Pitch Output');
        const oneBadge = statusBar.getByLabel('1 CV/Gate output configured');
        await expect(oneBadge).toBeVisible();
        await expect(oneBadge).toHaveText('1 CV/Gate');

        await run_palette_command(page, 'Add Gate Output');
        const twoBadge = statusBar.getByLabel('2 CV/Gate outputs configured');
        await expect(twoBadge).toBeVisible();
        await expect(twoBadge).toHaveText('2 CV/Gate');
    });
});
