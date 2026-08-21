import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function openMixer(page: Page): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock', exact: true });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    await expect(page.getByRole('region', { name: 'Mixer panel', exact: true })).toBeVisible();
}

test.describe('Mixer mute, pan, snapshot, and master', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: 'EDM' });
        await openMixer(page);
    });

    test('muting Kick on the mixer leaves Bass unmuted', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel', exact: true });
        const kick = mixer.getByRole('group', { name: 'Kick channel', exact: true });
        const bass = mixer.getByRole('group', { name: 'Bass channel', exact: true });

        await expect(kick.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('data-active', 'false');
        await expect(bass.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('data-active', 'false');

        await kick.getByRole('button', { name: 'Mute', exact: true }).click();
        await expect(kick.getByRole('button', { name: 'Unmute', exact: true })).toHaveAttribute('data-active', 'true');
        await expect(bass.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('data-active', 'false');
    });

    test('Kick pan starts centered and steps right', async ({ page }) => {
        const pan = page
            .getByRole('group', { name: 'Kick channel', exact: true })
            .getByRole('slider', { name: 'Kick pan', exact: true });
        await pan.scrollIntoViewIfNeeded();
        await expect(pan).toHaveAttribute('aria-valuenow', '0');
        await pan.focus();
        await page.keyboard.press('ArrowRight');
        await expect(pan).toHaveAttribute('aria-valuenow', '0.5');
    });

    test('saving a mixer snapshot enables recall', async ({ page }) => {
        const save = page.getByRole('button', { name: 'Save mixer snapshot', exact: true });
        const recall = page.getByRole('button', { name: 'Recall mixer snapshot', exact: true });
        await expect(recall).toBeDisabled();
        await save.click();
        await expect(recall).toBeEnabled();
        await recall.click();
        await expect(page.getByRole('button', { name: 'Snapshot 1', exact: true })).toBeVisible();
    });

    test('master gain starts at 0.8 and steps up', async ({ page }) => {
        const gain = page.getByTestId('master-gain').getByRole('slider', { name: 'Master gain', exact: true });
        await gain.scrollIntoViewIfNeeded();
        await expect(gain).toHaveAttribute('aria-valuenow', '0.8');
        await gain.focus();
        await page.keyboard.press('ArrowRight');
        await expect(gain).toHaveAttribute('aria-valuenow', '0.81');
    });
});
