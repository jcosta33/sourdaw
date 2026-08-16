import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openPreferencesAi(page: Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(dialog.getByText('AI execution backend')).toBeVisible();
}

// #1970 renamed "Automatic failover" to "Automatic local failover" and made
// the privacy semantics explicit: automatic stays LOCAL (native/WebLLM), and
// the cloud backend must be selected by name. Today's coverage is a presence
// regex on the section label — the select's options, persistence, and the
// privacy help text are all unasserted.
test.describe('Preferences — AI execution backend', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('selecting the hosted provider persists across a dialog reopen with its help text', async ({ page }) => {
        const dialog = page.getByRole('dialog');
        await openPreferencesAi(page);

        const backend = dialog.getByRole('combobox', { name: 'AI execution backend' });
        // Browser mode hides the native-only options; the initial value is
        // the resolved default ('auto' displays as resolveBackend()'s
        // outcome) — capture it and drive the flip from there.
        const options = backend.locator('option');
        await expect(options).toHaveCount(2);
        const initial = await backend.inputValue();
        expect(['webllm', 'cloud']).toContain(initial);
        const target = initial === 'cloud' ? 'webllm' : 'cloud';
        await backend.selectOption(target);
        await expect(backend).toHaveValue(target);
        // The browser help text names the privacy boundary.
        await expect(dialog.getByText(/hosted AI uses your configured provider/i)).toBeVisible();

        // The preference is store-backed, not dialog-local: close and reopen,
        // the committed backend shows (the preference store is memory-backed
        // in this build — no page reload occurs here, so the module-scope
        // store carries the value across the dialog round-trip).
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await openPreferencesAi(page);
        await expect(dialog.getByRole('combobox', { name: 'AI execution backend' })).toHaveValue(target);
        // NB: Reset Defaults is deliberately not asserted here — the default
        // preference is 'auto', which in browser mode DISPLAYS as the
        // resolveBackend() outcome (AiSection getSelectedBackend), not a
        // fixed option value.
    });
});
