import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('AI Features', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Generative AI panel shows generation options when toggled', async ({ page }) => {
        // Detailed grid option semantics live in GenerativeAiPanel.spec.tsx.
        await page.getByRole('button', { name: 'Generate', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Patterns', exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'AI', exact: true }).click();
        await expect(page.getByText('Describe the Music')).toBeVisible();
        await expect(page.getByTestId('genre-grid')).toBeVisible();
        await expect(page.getByTestId('mood-grid')).toBeVisible();
        await expect(page.getByTestId('instrument-grid')).toBeVisible();
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

    test('does not expose voice controls before a local voice model is available', async ({ page }) => {
        await expect(page.getByTestId('voice-command-button')).toHaveCount(0);
    });
});
