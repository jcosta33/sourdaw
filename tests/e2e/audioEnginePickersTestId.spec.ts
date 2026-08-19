import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// ---------------------------------------------------------------------------
// AudioEngine device pickers — Preferences → Audio.
//
// Closes a coverage gap: AudioEngine renders AudioDevicePicker, MidiDevicePicker,
// PluginScanSettings, and PluginBrowser, but no E2E asserted a state change on
// any of them. In a plain browser (Playwright Chromium, with no `window.sourdaw`
// bridge installed) the plugin-scanning surfaces gate on `hasPluginScanning` /
// `hasNativePlugins` (desktop-only) and render a disabled "Plugin scanning
// unavailable" empty state.
// MidiDevicePicker's branch depends on Web MIDI permission, which headless
// Chromium denies; its render state is indeterminate there (neither the live
// picker nor the unsupported empty state is reliably reached), so it is not
// asserted here.
//
// AudioDevicePicker is the one surface that stays live in-browser: it enumerates
// `navigator.mediaDevices` on mount with `loading=true`, then settles to
// `loading=false` once enumeration resolves. The output select's `disabled`
// attribute tracks that flag, so the refresh-driven loading → loaded round-trip
// is a real, DOM-observable state change — not a static existence check.
// ---------------------------------------------------------------------------

test.describe('AudioEngine pickers', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await dialog.waitFor({ state: 'visible', timeout: 5000 });
        await dialog.getByRole('button', { name: 'Audio', exact: true }).click();
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });

    test('Refresh audio devices drives the select disabled→enabled loading cycle', async ({ page }) => {
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        const outputSelect = dialog.getByRole('combobox', { name: 'Audio output device' });
        const refresh = dialog.getByRole('button', { name: 'Refresh audio devices' });

        // Wait for the mount-time enumeration to settle so the test starts from
        // a known loaded state.
        await expect(outputSelect).toBeEnabled({ timeout: 10_000 });
        await expect(refresh).toBeEnabled();

        // Clicking refresh sets `loading=true` synchronously (AudioDevicePicker
        // line 28), which disables the select; enumeration then resolves and
        // flips loading back to false. Capturing both halves of that round-trip
        // — disabled immediately after the click, enabled again once it settles
        // — proves the loading flag actually drives the select, instead of a
        // trivial always-enabled assertion that would pass with the flag removed.
        await refresh.click();
        await expect(outputSelect).toBeDisabled();
        await expect(outputSelect).toBeEnabled({ timeout: 10_000 });
    });

    test('Plugin scanning surfaces the desktop-only unavailable state', async ({ page }) => {
        // hasPluginScanning is desktop-only, so PluginScanSettings renders its
        // disabled empty state in-browser. Assert the conditional copy that only
        // renders when scanning is unavailable — the inverse branch (the live
        // scan controls) would never show this title.
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await expect(dialog.getByText('Plugin scanning unavailable')).toBeVisible();
    });
});
