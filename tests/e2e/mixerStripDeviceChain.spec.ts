import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addAudioTrack(page: Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i });
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add Audio Track');
    await page.getByRole('option', { name: 'Add Audio Track' }).click();
    await expect(page.getByRole('grid', { name: /Track list/i }).getByText('Audio', { exact: true }).first()).toBeVisible({ timeout: 5000 });
}

async function addDeviceFromInspector(page: Page): Promise<void> {
    await page.getByTestId('add-device-button').click();
    await page.getByRole('menu').getByRole('menuitem').first().click();
    // No fixed sleep: the add commits asynchronously and the first real
    // gate is the 10s device-row visibility assertion after the mixer
    // opens, which covers commit latency.
}

async function openMixer(page: Page): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    await dock.click();
    await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible({ timeout: 5000 });
}

// The mixer strip's device chain is the honest DOM-assertable half of the
// "MIDI in → device → mixer" chain: the device's presence on its strip, its
// double-click bypass, and its remove button with undo. Existing device-chain
// E2E is inspector-only; no mixer spec asserts a device at all.
test.describe('Mixer strip device chain', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addAudioTrack(page);
        await addDeviceFromInspector(page);
        await openMixer(page);
    });

    test('device shows on its strip; bypass flips, remove drops, undo restores', async ({ page }) => {
        const audio = page.getByRole('group', { name: 'Audio channel' });
        // Device rows are named "≡<Device>" (drag handle glyph + name); the
        // double-click action lives in the title attribute.
        const deviceRow = audio.getByRole('button', { name: /^≡/ }).first();
        await expect(deviceRow).toBeVisible({ timeout: 10_000 });

        // Double-click bypasses; the title names the action that a second
        // double-click would perform (enable after bypassing).
        await expect(deviceRow).toHaveAttribute('title', /double-click to bypass/i);
        await deviceRow.dblclick();
        await expect(deviceRow).toHaveAttribute('title', /double-click to enable/i);
        // Bypass is reversible from the surface itself.
        await deviceRow.dblclick();
        await expect(deviceRow).toHaveAttribute('title', /double-click to bypass/i);

        // Remove drops the device from the strip entirely.
        await audio.getByRole('button', { name: /^Remove /i }).first().click();
        await expect(deviceRow).toHaveCount(0);

        // The removal went through the action boundary: transport-undo
        // restores the device row to the strip.
        const undo = page.getByTestId('transport-undo');
        await expect(undo).toBeEnabled({ timeout: 10_000 });
        await undo.click();
        await expect(audio.getByRole('button', { name: /^≡/ }).first()).toBeVisible({
            timeout: 10_000,
        });
    });
});
