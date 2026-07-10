import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('AI Features', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can toggle the Generative AI panel via Generate button', async ({ page }) => {
        await page.getByRole('button', { name: 'Generate' }).click();
        await page.waitForTimeout(1000);

        const panel = page.getByText(/Genre|Mood|Pattern|Instrument/i);
        const visible = await panel.first().isVisible().catch(() => false);
        expect(visible).toBe(true);
    });

    test('Can toggle the AI chat panel', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle AI chat panel' }).click();
        await expect(page.getByText(/The kitchen is quiet/i)).toBeVisible({ timeout: 5000 });

        await page.getByRole('button', { name: 'Toggle AI chat panel' }).click();
        await expect(page.getByText(/The kitchen is quiet/i)).toBeHidden();
    });

    test('AI action history toggle is present', async ({ page }) => {
        const history = page.getByRole('button', { name: /Toggle AI action history/i });
        await expect(history).toBeVisible();
    });

    test('Voice command button is present', async ({ page }) => {
        await expect(page.getByRole('button', { name: /Voice command/i })).toBeVisible();
    });

    test('Load AI button is present', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Load AI' })).toBeVisible();
    });

    test('Can open the AI chat panel and find the composer input', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle AI chat panel' }).click();
        await page.waitForTimeout(500);

        const composer = page.getByPlaceholder(/message/i).or(page.getByRole('textbox').last());
        const visible = await composer.first().isVisible().catch(() => false);
        expect(visible).toBe(true);
    });
});
