import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

async function create_bus(page: import('@playwright/test').Page): Promise<string> {
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Create Bus' }).click();
    // Bus tracks are named "Bus 1", "Bus 2", …; wait on the first one so the
    // bus exists before the mixer queries it.
    const trackList = page.getByRole('grid', { name: /Track list/i });
    await expect(trackList.getByText('Bus 1', { exact: true }).first()).toBeVisible({ timeout: 5000 });
    return 'Bus 1';
}

async function openMixer(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    await dock.click();
    await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible({ timeout: 5000 });
}

// Mixer sends + output routing are the two strip controls with no state-change
// E2E: the existing mixerWidthSendsTestId spec asserts only width/snapshot
// existence (no send interaction), and the only routing test opens the menu
// without changing the target. These specs cover the real flows: raising a
// send level moves the slider, toggling pre/post flips the latch, and routing a
// channel to a bus updates the output readout.
test.describe('Mixer sends + output routing — state changes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
        await create_bus(page);
        await openMixer(page);
    });

    test('raising a send level moves the send slider value', async ({ page }) => {
        // Scope to the Audio channel strip: every strip (incl. master/bus) has
        // a Send to Bus 1 slider, so the Audio group is the unambiguous target.
        const audio = page.getByRole('group', { name: 'Audio channel' });
        const send = audio.getByRole('slider', { name: 'Send to Bus 1' });
        await expect(send).toBeVisible({ timeout: 10_000 });

        const before = Number(await send.getAttribute('aria-valuenow'));
        await send.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await send.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('toggling a send flips pre/post latch label and aria-label', async ({ page }) => {
        const audio = page.getByRole('group', { name: 'Audio channel' });
        const send = audio.getByRole('slider', { name: 'Send to Bus 1' });
        const latch = audio.getByRole('button', { name: /Toggle send to Bus 1 .*-fader/i });
        await expect(latch).toBeVisible({ timeout: 10_000 });

        // The send must exist before its pre/post flag can toggle — a brand-new
        // send at zero level has no send object (toggleSendPreFader no-ops until
        // setSend creates one), so raise the level first.
        await send.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);

        // Default is post-fader: the label shows POST, and the aria-label names
        // the action that toggling performs (switch TO pre): "pre-fader".
        await expect(latch).toContainText('POST');
        await expect(latch).toHaveAttribute('aria-label', /Toggle send to Bus 1 pre-fader/i);

        await latch.click();
        await page.waitForTimeout(200);

        // Toggling flips to pre-fader: label PRE, and the aria-label now names
        // the switch-TO-post action.
        await expect(latch).toContainText('PRE');
        await expect(latch).toHaveAttribute('aria-label', /Toggle send to Bus 1 post-fader/i);
    });

    test('routing a channel to a bus updates the output readout', async ({ page }) => {
        // Scope to the Audio channel strip so the master/bus output buttons
        // do not collide.
        const audio = page.getByRole('group', { name: 'Audio channel' });
        const outputButton = audio.locator('button[aria-haspopup="listbox"]');
        await expect(outputButton).toContainText('Master');

        // Open the routing menu — aria-expanded flips false→true.
        await expect(outputButton).toHaveAttribute('aria-expanded', 'false');
        await outputButton.click();
        await expect(outputButton).toHaveAttribute('aria-expanded', 'true');

        // Selecting the bus routes the channel to it; the readout changes Master→Bus 1.
        const menu = page.getByRole('listbox', { name: 'Output routing' });
        await menu.getByRole('option', { name: 'Bus 1' }).click();
        await expect(outputButton).toContainText('Bus 1');
    });
});
