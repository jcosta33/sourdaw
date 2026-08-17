import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const KOKORO_DOWNLOAD_URL =
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_q8f16.onnx';

async function open_preferences_ai_section(page: Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(dialog.getByText('AI execution backend').first()).toBeVisible();
    await expect(dialog.getByLabel('AI Model Manager')).toBeVisible();
}

test.describe('Browser AI model removal', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_preferences_ai_section(page);
    });

    test('a fresh profile offers only the admitted model download', async ({ page }) => {
        const dialog = page.getByRole('dialog');

        await expect(dialog.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Remove .+ from storage/ })).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: /Retry downloading .+/ })).toHaveCount(0);
        expect(await dialog.getByText('Unavailable', { exact: true }).count()).toBeGreaterThanOrEqual(4);
    });

    test('a stored model returns to Download after removal', async ({ page }) => {
        const dialog = page.getByRole('dialog');
        await page.route(KOKORO_DOWNLOAD_URL, (route) => route.fulfill({ body: 'stub-kokoro-onnx-bytes' }));

        const download_button = dialog.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ });
        await download_button.click();

        const ready_badge = dialog.getByLabel('Kokoro-82M (q8f16) downloaded and ready');
        const remove_button = dialog.getByRole('button', { name: 'Remove Kokoro-82M (q8f16) from storage' });
        await expect(ready_badge).toBeVisible({ timeout: 15_000 });
        await expect(remove_button).toBeVisible();

        await remove_button.click();

        await expect(download_button).toBeVisible();
        await expect(ready_badge).toHaveCount(0);
        await expect(remove_button).toHaveCount(0);
    });

    test('a failed download can be retried', async ({ page }) => {
        const dialog = page.getByRole('dialog');
        await page.route(KOKORO_DOWNLOAD_URL, (route) => route.abort('failed'));

        const download_button = dialog.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ });
        await download_button.click();

        const failed_badge = dialog.getByLabel('Kokoro-82M (q8f16) download failed');
        const retry_button = dialog.getByRole('button', { name: 'Retry downloading Kokoro-82M (q8f16)' });
        await expect(failed_badge).toBeVisible({ timeout: 15_000 });
        await expect(retry_button).toBeVisible();

        await retry_button.click();

        const progress_bar = dialog.getByRole('progressbar', { name: /Downloading Kokoro-82M \(q8f16\):/ });
        await expect(progress_bar).toBeVisible();
        await expect(progress_bar).toHaveAttribute('aria-valuenow', '0');
    });
});
