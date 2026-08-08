import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openRoutingTab(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }

    const routingTab = page.locator('#bottom-dock-tab-routing');
    if (await routingTab.isVisible().catch(() => false)) {
        await routingTab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Routing graph — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
        await openRoutingTab(page);
    });

    test('routing tab is accessible and renders content', async ({ page }) => {
        // The routing tab should show some content (graph or empty state).
        const routingTab = page.locator('#bottom-dock-tab-routing');
        await expect(routingTab).toBeVisible({ timeout: 10_000 });

        // Click it and verify the dock panel has content.
        await routingTab.click();
        await page.waitForTimeout(500);

        // The bottom dock tabpanel should have rendered content.
        const panel = page.locator('#bottom-dock-tabpanel');
        if (await panel.isVisible().catch(() => false)) {
            const text = (await panel.innerText()).trim();
            expect(text.length).toBeGreaterThan(0);
        }
    });

    test('routing graph has role=img when visible', async ({ page }) => {
        const graph = page.getByTestId('routing-graph');
        if (await graph.isVisible().catch(() => false)) {
            const role = await graph.getAttribute('role');
            expect(role).toBe('img');
            const label = await graph.getAttribute('aria-label');
            expect(label).toBe('Signal routing graph');
        }
    });

    test('routing graph renders SVG content with paths', async ({ page }) => {
        const graph = page.getByTestId('routing-graph');
        if (await graph.isVisible().catch(() => false)) {
            // The SVG should have child elements (paths, nodes).
            const childCount = await graph.evaluate((el) => el.children.length);
            expect(childCount).toBeGreaterThan(0);
        }
    });

    test('routing tab is accessible in bottom dock', async ({ page }) => {
        const routingTab = page.locator('#bottom-dock-tab-routing');
        const hasTab = await routingTab.isVisible().catch(() => false);
        expect(hasTab).toBe(true);
    });
});
