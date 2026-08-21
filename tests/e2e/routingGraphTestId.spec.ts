import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function expandSignalFlow(page: Page): Promise<void> {
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    const toggle = inspector.getByRole('button', { name: /Signal Flow/ });
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test.describe('Routing graph — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
        await openBottomTab(page, 'Routing');
    });

    test('routing tab is selected in the bottom dock', async ({ page }) => {
        const tab = page
            .getByRole('tablist', { name: 'Bottom dock' })
            .getByRole('tab', { name: 'Routing', exact: true });
        await expect(tab).toBeVisible();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
    });

    test('routing matrix shows the MIDI track output to Master', async ({ page }) => {
        const output = page.getByRole('button', { name: 'MIDI output routed to Master' });
        await expect(output).toBeVisible();
        await expect(output).toBeDisabled();
    });

    test('expanding Signal Flow reveals the routing graph', async ({ page }) => {
        await expandSignalFlow(page);
        const graph = page.getByRole('img', { name: 'Signal routing graph' });
        await expect(graph).toBeVisible();
        await expect(graph).toHaveAttribute('data-testid', 'routing-graph');
        await expect(page.getByRole('button', { name: 'Select MIDI' })).toBeVisible();
    });

    test('clicking a routing node selects that track in the track list', async ({ page }) => {
        await expandSignalFlow(page);

        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const midiRow = trackList
            .getByRole('row')
            .filter({ has: page.getByText('MIDI', { exact: true }) })
            .first();

        await page.getByRole('button', { name: 'Select Master' }).click();
        await expect(midiRow).toHaveAttribute('aria-selected', 'false');

        await page.getByRole('button', { name: 'Select MIDI' }).click();
        await expect(midiRow).toHaveAttribute('aria-selected', 'true');
    });
});
