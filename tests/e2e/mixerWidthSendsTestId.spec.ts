import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function openMixer(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Toggle bottom dock', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Mixer panel', exact: true })).toBeVisible();
}

test.describe('Mixer channel width and sends', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: 'EDM' });
        await openMixer(page);
    });

    test('channel width cycles from normal to wide', async ({ page }) => {
        const width = page.getByRole('button', { name: 'Channel width: normal', exact: true });
        await expect(width).toBeVisible();
        await width.click();
        await expect(page.getByRole('button', { name: 'Channel width: wide', exact: true })).toBeVisible();
    });

    test('Clap send to Reverb Plate starts at the template level and steps up', async ({ page }) => {
        const clap = page.getByRole('group', { name: 'Clap channel', exact: true });
        const send = clap.getByRole('slider', { name: 'Send to Reverb Plate', exact: true });
        await send.scrollIntoViewIfNeeded();
        await expect(send).toHaveAttribute('aria-valuenow', '85');
        await send.focus();
        await page.keyboard.press('ArrowRight');
        await expect(send).toHaveAttribute('aria-valuenow', '86');
    });

    test('Clap Reverb Plate send starts post-fader and latches to pre', async ({ page }) => {
        const clap = page.getByRole('group', { name: 'Clap channel', exact: true });
        const toggle = clap.getByRole('button', { name: 'Toggle send to Reverb Plate pre-fader', exact: true });
        await toggle.scrollIntoViewIfNeeded();
        await expect(toggle).toHaveAttribute('data-active', 'false');
        await toggle.click();
        await expect(
            clap.getByRole('button', { name: 'Toggle send to Reverb Plate post-fader', exact: true })
        ).toHaveAttribute('data-active', 'true');
    });
});
