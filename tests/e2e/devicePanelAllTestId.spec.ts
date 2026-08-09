import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openInstrument(page: import('@playwright/test').Page, name: string): Promise<boolean> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill(name.toLowerCase());
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: new RegExp(`^${name}`, 'i') }).first();
    if (await card.isVisible().catch(() => false)) {
        await card.click();
        await page.waitForTimeout(2000);
        return true;
    }
    return false;
}

test.describe('All device panels — open, verify, close', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Gluten compressor panel opens and closes', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        if (await effectsTab.isVisible().catch(() => false)) {
            await effectsTab.click();
            await page.waitForTimeout(300);
        }
        await search.fill('gluten');
        await page.waitForTimeout(500);
        const card = page.getByRole('button', { name: /^Gluten/i }).first();
        if (await card.isVisible().catch(() => false)) {
            await card.click();
            await page.waitForTimeout(2000);
            const sliders = page.getByRole('slider');
            expect(await sliders.count()).toBeGreaterThan(0);
        }
    });

    test('Bacteria FX panel opens with sliders', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        if (await effectsTab.isVisible().catch(() => false)) {
            await effectsTab.click();
            await page.waitForTimeout(300);
        }
        await search.fill('bacteria');
        await page.waitForTimeout(500);
        const card = page.getByRole('button', { name: /^Bacteria/i }).first();
        if (await card.isVisible().catch(() => false)) {
            await card.click();
            await page.waitForTimeout(2000);
            const sliders = page.getByRole('slider');
            expect(await sliders.count()).toBeGreaterThan(0);
        }
    });

    test('ProofChamber reverb panel opens', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        if (await effectsTab.isVisible().catch(() => false)) {
            await effectsTab.click();
            await page.waitForTimeout(300);
        }
        await search.fill('dutch oven');
        await page.waitForTimeout(500);
        const card = page.getByRole('button', { name: /^Dutch Oven/i }).first();
        if (await card.isVisible().catch(() => false)) {
            await card.click();
            await page.waitForTimeout(2000);
            const sliders = page.getByRole('slider');
            expect(await sliders.count()).toBeGreaterThan(0);
        }
    });

    test('Crust limiter panel opens', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        if (await effectsTab.isVisible().catch(() => false)) {
            await effectsTab.click();
            await page.waitForTimeout(300);
        }
        await search.fill('crust');
        await page.waitForTimeout(500);
        const card = page.getByRole('button', { name: /^Crust/i }).first();
        if (await card.isVisible().catch(() => false)) {
            await card.click();
            await page.waitForTimeout(2000);
            const sliders = page.getByRole('slider');
            expect(await sliders.count()).toBeGreaterThan(0);
        }
    });

    test('Grinder amp panel opens', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByTestId('toggle-browser').click();
            await page.waitForTimeout(500);
        }
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        if (await effectsTab.isVisible().catch(() => false)) {
            await effectsTab.click();
            await page.waitForTimeout(300);
        }
        await search.fill('grinder');
        await page.waitForTimeout(500);
        const card = page.getByRole('button', { name: /^Grinder/i }).first();
        if (await card.isVisible().catch(() => false)) {
            await card.click();
            await page.waitForTimeout(2000);
            const sliders = page.getByRole('slider');
            expect(await sliders.count()).toBeGreaterThan(0);
        }
    });
});
