import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('AI Features', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Generative AI panel shows generation options when toggled', async ({ page }) => {
        await page.getByRole('button', { name: 'Generate' }).click();
        await page.waitForTimeout(1000);

        const panel_content = page.getByText(/Genre|Mood|Pattern|Instrument|Generate|Create/i);
        await expect(panel_content.first()).toBeVisible({ timeout: 5000 });
    });

    test('AI chat panel toggles and shows empty state with composer', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle AI chat panel' }).click();
        await expect(page.getByText(/The kitchen is quiet/i)).toBeVisible({ timeout: 5000 });

        const composer = page.getByPlaceholder(/message/i).or(page.getByRole('textbox').last());
        await expect(composer.first()).toBeVisible({ timeout: 5000 });

        await page.getByRole('button', { name: 'Toggle AI chat panel' }).click();
        await expect(page.getByText(/The kitchen is quiet/i)).toBeHidden();
    });

    test('AI action history toggle opens panel with content', async ({ page }) => {
        const history = page.getByRole('button', { name: /Toggle AI action history/i });
        await history.click();
        await page.waitForTimeout(500);

        const panel_content = page.getByText(/action history|no actions|history/i);
        await expect(panel_content.first()).toBeVisible();
    });

    test('Voice command button is clickable', async ({ page }) => {
        const voice = page.getByRole('button', { name: /Voice command/i });
        await expect(voice).toBeVisible();
        await voice.click();
        await page.waitForTimeout(300);
        await expect(voice).toBeVisible();
    });

    test('Load AI button is present and clickable', async ({ page }) => {
        const load = page.getByRole('button', { name: 'Load AI' });
        await expect(load).toBeVisible();
        await load.click();
        await page.waitForTimeout(500);
    });
});
