import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Status bar metrics depth. Existing spec asserts "text matches /CPU|Latency/i"
// — existence-only. This asserts the metric readouts render live-formatted
// values (Rate becomes a real kHz readout, Latency a real ms value) after the
// audio engine initializes on the EDM template.
test.describe('Status bar metrics — live readout formats', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await wait_for_workspace_ready(page);
        await page.waitForTimeout(1000);
    });

    test('Rate readout shows a real sample-rate value after boot', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        await expect(status).toBeVisible({ timeout: 5000 });

        // The Rate readout starts as the literal "0kHz" placeholder; after the
        // audio context initializes it becomes a real value like "44.1kHz" or
        // "48kHz" — the "0kHz" placeholder is gone.
        const rateRow = status.getByText('Rate').locator('..');
        const rateValue = rateRow.locator('span').last();
        await expect.poll(async () => rateValue.innerText(), { timeout: 15_000 }).not.toBe('0kHz');
    });

    test('Latency readout shows a real ms value after boot', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        await expect(status).toBeVisible({ timeout: 5000 });

        // Same contract: the "0.0ms" placeholder is replaced by a live value.
        const latencyRow = status.getByText('Latency').locator('..');
        const latencyValue = latencyRow.locator('span').last();
        await expect.poll(async () => latencyValue.innerText(), { timeout: 15_000 }).not.toBe('0.0ms');
    });
});
