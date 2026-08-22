import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter oscillator waveform', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('Sine latches and releases default Saw', async ({ page }) => {
        const waveformRow = page
            .locator('.fermenter-faceplate')
            .getByRole('button', { name: 'Triangle', exact: true })
            .locator('xpath=..');
        const saw = waveformRow.getByRole('button', { name: 'Saw', exact: true });
        const sine = waveformRow.getByRole('button', { name: 'Sine', exact: true });

        await expect(saw).toHaveAttribute('aria-pressed', 'true');
        await expect(sine).not.toHaveAttribute('aria-pressed', 'true');

        await sine.dispatchEvent('click');

        await expect(sine).toHaveAttribute('aria-pressed', 'true');
        await expect(saw).not.toHaveAttribute('aria-pressed', 'true');
    });
});
