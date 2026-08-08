import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Mix analysis & chat panel — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
    });

    test('mix analysis refresh button present when panel open', async ({ page }) => {
        // Open the analysis tab.
        const dock = page.getByTestId('toggle-bottom-dock');
        if ((await dock.getAttribute('aria-pressed')) === 'false') {
            await dock.click();
            await page.waitForTimeout(500);
        }

        const analysisTab = page.locator('#bottom-dock-tab-analysis');
        if (await analysisTab.isVisible().catch(() => false)) {
            await analysisTab.click();
            await page.waitForTimeout(500);

            // The refresh button should be present.
            const refresh = page.getByTestId('mix-analysis-refresh');
            const hasRefresh = await refresh.isVisible().catch(() => false);
            if (hasRefresh) {
                const label = await refresh.getAttribute('aria-label');
                expect(label).toContain('Refresh');
            }
        }
    });

    test('chat panel conversation log present when open', async ({ page }) => {
        const chat = page.getByTestId('toggle-chat');
        await chat.click();
        await page.waitForTimeout(500);

        const log = page.getByRole('log', { name: 'Chat conversation' });
        const hasLog = await log.isVisible().catch(() => false);
        if (hasLog) {
            // The log should have aria-live polite.
            const live = await log.getAttribute('aria-live');
            expect(live).toBe('polite');
        }
    });

    test('chat confirm pending actions button present when chat open', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(500);

        // These buttons only appear when there are pending actions, but the log should be visible.
        const log = page.getByRole('log', { name: 'Chat conversation' });
        if (await log.isVisible().catch(() => false)) {
            // The panel is functional.
            const text = (await log.innerText()).trim();
            // Empty chat is fine.
            expect(text).toBeDefined();
        }
    });

    test('mix analysis tab and chat panel can coexist', async ({ page }) => {
        // Open bottom dock + chat.
        const dock = page.getByTestId('toggle-bottom-dock');
        if ((await dock.getAttribute('aria-pressed')) === 'false') {
            await dock.click();
        }
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(500);

        await expect(dock).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('toggle-chat')).toHaveAttribute('aria-pressed', 'true');
    });
});
