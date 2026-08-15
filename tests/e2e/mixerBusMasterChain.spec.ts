import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addTrack(page: Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

async function createBus(page: Page): Promise<void> {
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Create Bus' }).click();
    await expect(
        page.getByRole('grid', { name: /Track list/i }).getByText('Bus 1', { exact: true }).first(),
    ).toBeVisible({ timeout: 5000 });
}

async function openMixer(page: Page): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    await dock.click();
    await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible({ timeout: 5000 });
}

// Channel→bus routing is covered one hop at a time; the two-hop chain — a
// channel into a bus whose own output feeds Master — has never been asserted
// as one flow, nor that the routing survives a dock tab round-trip.
test.describe('Mixer track→bus→master routing chain', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addTrack(page, 'Audio');
        await createBus(page);
        await openMixer(page);
    });

    test('the full chain routes and holds across a dock tab round-trip', async ({ page }) => {
        const audio = page.getByRole('group', { name: 'Audio channel' });
        const bus = page.getByRole('group', { name: 'Bus 1 channel' });

        // Hop one: Audio channel → Bus 1.
        const audioOutput = audio.locator('button[aria-haspopup="listbox"]');
        await expect(audioOutput).toContainText('Master');
        await audioOutput.click();
        await page.getByRole('listbox', { name: 'Output routing' }).getByRole('option', { name: 'Bus 1' }).click();
        await expect(audioOutput).toContainText('Bus 1');

        // Hop two: the bus strip feeds Master by default — the chain's exit.
        // (A creation-time default, asserted as such; the user-driven routing
        // path is exercised on the Audio strip above.)
        const busOutput = bus.locator('button[aria-haspopup="listbox"]');
        await expect(busOutput).toContainText('Master');

        // The routing is strip state, not view state: unmounting the mixer
        // (dock tab away and back) must not lose either readout.
        await page.getByRole('tab', { name: 'Editor' }).click();
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeHidden();
        await page.locator('#bottom-dock-tab-mixer').click();
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible({ timeout: 5000 });

        await expect(audio.locator('button[aria-haspopup="listbox"]')).toContainText('Bus 1');
        await expect(bus.locator('button[aria-haspopup="listbox"]')).toContainText('Master');
    });
});
