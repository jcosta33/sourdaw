import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('Automation lanes on EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await openBottomTab(page, 'Automation');
    });

    test('automation tab is accessible and shows mode button', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        await expect(mode).toBeVisible();
        await expect(mode).toHaveAttribute('aria-label', /Automation mode/);
    });

    test('automation mode dropdown lists read/write/touch/latch', async ({ page }) => {
        const mode = page.getByTestId('automation-mode-button');
        await expect(mode).toBeVisible();
        await mode.click();

        for (const name of ['Read', 'Write', 'Touch', 'Latch'] as const) {
            await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
        }

        await page.keyboard.press('Escape');
    });

    test('transport play/stop works with automation tab open', async ({ page }) => {
        const playhead = page.getByTestId('transport-playhead');
        const play = page.getByTestId('transport-play');
        await expect(playhead).toHaveText(/1\.1\.000/);
        await expect(play).toHaveAttribute('aria-label', 'Play');

        await play.click();
        await expect(playhead).not.toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await expect(play).toHaveAttribute('aria-label', 'Pause');

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await expect(play).toHaveAttribute('aria-label', 'Play');
    });

    test('automation tab and mixer tab can be switched', async ({ page }) => {
        const tabs = page.getByRole('tablist', { name: 'Bottom dock' });
        const mixer = tabs.getByRole('tab', { name: 'Mixer', exact: true });
        const automation = tabs.getByRole('tab', { name: 'Automation', exact: true });

        await mixer.click();
        await expect(mixer).toHaveAttribute('aria-selected', 'true');

        await automation.click();
        await expect(automation).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('automation-mode-button')).toBeVisible();
    });

    test('solo mode SIP is checked while the automation tab is open', async ({ page }) => {
        const sip = page.getByTestId('solo-mode-sip');
        await expect(sip).toBeVisible();
        await expect(sip).toHaveAttribute('aria-checked', 'true');
    });
});
