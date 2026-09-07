import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// ---------------------------------------------------------------------------
// Transport — loop toggle round-trips via aria-pressed.
// ---------------------------------------------------------------------------

test.describe('Transport recording flow', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Loop toggle round-trips aria-pressed true → false', async ({ page }) => {
        const loop = page.getByRole('button', { name: 'Loop', exact: true });
        await expect(loop).toHaveAttribute('aria-pressed', 'false');

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'true');

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'false');
    });

    test('Play then Stop leaves the transport stable', async ({ page }) => {
        const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
        const stop = page.getByRole('button', { name: 'Stop' });

        await play.first().click();
        await page.waitForTimeout(400);
        await stop.click();
        await page.waitForTimeout(400);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
        // After stop, the Play button is available again (not stuck on Pause).
        await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Chord track (Pop Song) — follow toggle flips aria-pressed.
// ---------------------------------------------------------------------------

test.describe('Chord track with template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('Harmonic-follow toggle flips aria-pressed', async ({ page }) => {
        const chord_track = page.getByRole('region', { name: 'Chord track' });
        await expect(chord_track).toBeVisible();

        const follow = chord_track.getByRole('button', { name: /harmonic following/i });
        const before = await follow.getAttribute('aria-pressed');
        await follow.click();
        await expect(follow).not.toHaveAttribute('aria-pressed', before ?? '');
    });
});

// ---------------------------------------------------------------------------
// Arrangement sections — right-click → Add Section grows the section list.
// ---------------------------------------------------------------------------

test.describe('Arrangement sections', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Right-click → Add Section creates a section', async ({ page }) => {
        const sections = page.getByRole('region', { name: 'Arrangement sections' });
        await expect(sections.getByText('Right-click to add arrangement sections')).toBeVisible();

        const box = await sections.boundingBox();
        if (!box) {
            throw new Error('sections region missing');
        }
        await sections.click({ button: 'right', position: { x: 50, y: box.height * 0.5 } });

        // The context menu is a floating surface (not role=menu); click by text.
        await page.getByText('Add Section', { exact: true }).click();
        await page.waitForTimeout(500);

        // The empty hint is gone; a named section appears.
        await expect(sections.getByText('Right-click to add arrangement sections')).toHaveCount(0);
        await expect(sections.getByText(/New Section/i)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Adjustment layer — persists in the strip after creation.
// ---------------------------------------------------------------------------

test.describe('Adjustment layer interactions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Creating a volume adjustment layer adds a named row', async ({ page }) => {
        const strip = page.getByRole('region', { name: 'Adjustment layers' });
        await strip.getByRole('button', { name: 'Add adjustment layer' }).click();
        // The effect-type picker is a floating surface (not role=menu); click by text.
        await page.getByText('Volume', { exact: true }).click();
        await page.waitForTimeout(500);

        await expect(strip.getByText(/Volume Layer/i)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Panel layout — toggles round-trip the panel visibility.
// ---------------------------------------------------------------------------

test.describe('Panel layout persistence', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Browser toggle hides then restores the panel', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle browser' });
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await expect(browser).toBeVisible();

        await toggle.click();
        await expect(browser).toHaveCount(0);

        await toggle.click();
        await expect(browser).toBeVisible();
    });

    test('Inspector toggle hides then restores the panel', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle inspector' });
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();

        await toggle.click();
        await expect(inspector).toHaveCount(0);

        await toggle.click();
        await expect(inspector).toBeVisible();
    });

    test('Bottom dock opens and closes via its toggle and close button', async ({ page }) => {
        const dock_toggle = page.getByRole('button', { name: 'Toggle bottom dock' });
        const panel = page.locator('#bottom-dock-tabpanel');

        await dock_toggle.click();
        await expect(panel).toBeVisible();
        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(panel).toHaveCount(0);
    });
});
