import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Transport Play chip', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('Play relabels to Stop while the sequencer runs and Stop restores Play', async ({ page }) => {
        const transport = page.locator('section').filter({ has: page.getByText('Transport', { exact: true }) });
        const play = transport.getByRole('button', { name: 'Play', exact: true });
        const stop = transport.getByRole('button', { name: 'Stop', exact: true });
        const stepCursor = page.getByText('Playback cursor', { exact: true }).locator('xpath=..');

        const readStep = async (): Promise<number> => {
            const match = (await stepCursor.innerText()).match(/Step\s+(\d+)/i);
            return match ? Number(match[1]) : Number.NaN;
        };

        await expect(play).toBeEnabled();
        await expect(play).not.toHaveAttribute('aria-pressed', 'true');
        await expect.poll(readStep).toBe(1);

        await play.click();
        await expect(stop).toBeVisible();
        await expect(stop).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(readStep).toBeGreaterThan(1);

        await stop.click();
        await expect(play).toBeVisible();
        await expect(play).not.toHaveAttribute('aria-pressed', 'true');
        await expect.poll(readStep).toBe(1);
    });
});
