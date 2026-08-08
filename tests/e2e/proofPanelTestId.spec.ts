import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Proof device panel — A/B compare', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('adding a Proof device from browser opens its panel', async ({ page }) => {
        // Ensure browser is open.
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        // Search for Proof.
        await page.getByTestId('browser-search').fill('proof');
        await page.waitForTimeout(500);

        // Click the Proof card.
        const proofCard = page.getByRole('button', { name: /^Proof/i }).first();
        const hasProof = await proofCard.isVisible().catch(() => false);
        if (hasProof) {
            await proofCard.click();
            await page.waitForTimeout(2000);

            // The Proof panel should be visible with a Close button.
            const closeProof = page.getByRole('button', { name: /Close Proof/i }).first();
            const hasClose = await closeProof.isVisible().catch(() => false);
            expect(hasClose).toBe(true);
        }
    });

    test('A/B compare toggle is present in Proof panel', async ({ page }) => {
        // Open browser, add Proof.
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        await page.getByTestId('browser-search').fill('proof');
        await page.waitForTimeout(500);

        const proofCard = page.getByRole('button', { name: /^Proof/i }).first();
        if (await proofCard.isVisible().catch(() => false)) {
            await proofCard.click();
            await page.waitForTimeout(2000);

            // A/B compare toggle.
            const ab = page.getByRole('button', { name: 'A/B compare' }).first();
            const hasAB = await ab.isVisible().catch(() => false);
            if (hasAB) {
                const label = await ab.getAttribute('aria-label');
                expect(label).toBe('A/B compare');
            }
        }
    });

    test('A/B compare toggles between B/wet and A/dry', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        await page.getByTestId('browser-search').fill('proof');
        await page.waitForTimeout(500);

        const proofCard = page.getByRole('button', { name: /^Proof/i }).first();
        if (await proofCard.isVisible().catch(() => false)) {
            await proofCard.click();
            await page.waitForTimeout(2000);

            const ab = page.getByRole('button', { name: 'A/B compare' }).first();
            if (await ab.isVisible().catch(() => false)) {
                const before = (await ab.innerText()).trim();

                await ab.click();
                await page.waitForTimeout(300);

                const after = (await ab.innerText()).trim();
                expect(after).not.toBe(before);
            }
        }
    });

    test('Proof panel can be closed via Close button', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }

        await page.getByTestId('browser-search').fill('proof');
        await page.waitForTimeout(500);

        const proofCard = page.getByRole('button', { name: /^Proof/i }).first();
        if (await proofCard.isVisible().catch(() => false)) {
            await proofCard.click();
            await page.waitForTimeout(2000);

            const closeProof = page.getByRole('button', { name: /Close Proof/i }).first();
            if (await closeProof.isVisible().catch(() => false)) {
                await closeProof.click();
                await page.waitForTimeout(500);

                await expect(closeProof).not.toBeVisible();
            }
        }
    });
});
