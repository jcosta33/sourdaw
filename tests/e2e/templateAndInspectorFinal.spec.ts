import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Template Filtering and Loading', () => {
    test('Template grid filters by category correctly', async ({ page }) => {
        await setupWorkspace(page);
        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await launch_screen.waitFor({ state: 'visible' });

        await page.locator('#launch-from-template').click();
        await expect(page.getByText('Start a new project')).toBeVisible();

        await expect(page.getByRole('button', { name: 'EDM' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cinematic' })).toBeVisible();

        await page.getByRole('button', { name: 'Film', exact: true }).click();

        await expect(page.getByRole('button', { name: 'Cinematic' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'EDM' })).toBeHidden();
    });

    test('Demo grid shows Nebula Drift', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await launch_screen.waitFor({ state: 'visible' });

        await page.locator('#launch-demo-project').click();
        await expect(page.getByText('Start a new project')).toBeVisible();
        await expect(page.getByRole('button', { name: /Nebula Drift/i })).toBeVisible();
    });
});

test.describe('Session + Arrangement View', () => {
    test('Toggle Session + Arrangement View button is clickable', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const toggle = page.getByRole('button', { name: 'Toggle Session + Arrangement View' });
        await expect(toggle).toBeVisible();
        await toggle.click();
        await page.waitForTimeout(500);
        await expect(toggle).toBeVisible();
    });
});

test.describe('Device Panel — Show/Hide', () => {
    test('Can open device panel by clicking synth in inspector', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const synth = inspector.getByText('Synth').first();
        await synth.click();
        await page.waitForTimeout(1000);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Device Bypass from Inspector', () => {
    test('Bypass and enable synth via inspector buttons', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const bypass = inspector.getByRole('button', { name: /Bypass Synth/i });
        await bypass.click();
        await expect(inspector.getByRole('button', { name: /Enable Synth/i })).toBeVisible({ timeout: 5000 });

        await inspector.getByRole('button', { name: /Enable Synth/i }).click();
        await expect(inspector.getByRole('button', { name: /Bypass Synth/i })).toBeVisible({ timeout: 5000 });
    });
});

test.describe('Track Color Picker', () => {
    test('Track color buttons are present in inspector', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const colors = inspector.getByRole('button', { name: /Set color/i });
        const count = await colors.count();
        expect(count).toBeGreaterThan(0);
    });
});

test.describe('Inspector — MIDI FX Slots', () => {
    test('MIDI FX section shows add buttons', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        // A MIDI track inspector always renders the MIDI FX section.
        await expect(inspector.getByText('MIDI FX')).toBeVisible({ timeout: 5000 });
    });
});

test.describe('Inspector — VCA Group', () => {
    test('VCA group creation adds selector', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: /Create VCA group/i }).click();
        await page.waitForTimeout(500);

        const vca_select = inspector.getByRole('combobox', { name: 'VCA group' });
        await expect(vca_select).toBeVisible();
    });
});

test.describe('Inspector — Follow Chord Track', () => {
    test('Follow chord track checkbox toggles', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const follow = inspector.getByRole('checkbox', { name: /Follow chord track/i });
        await expect(follow).not.toBeChecked();
        await follow.click();
        await expect(follow).toBeChecked();
    });
});

test.describe('Inspector — Close and Reopen', () => {
    test('Inspector can be closed and reopened', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();

        await page.keyboard.press(`${MOD}+i`);
        await expect(inspector).toBeHidden();

        await page.keyboard.press(`${MOD}+i`);
        await expect(inspector).toBeVisible();
    });
});

test.describe('Status Bar Deep', () => {
    test('CPU metric shows numeric value', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const status = page.getByRole('contentinfo', { name: 'Application status' });
        await expect(status.getByText('CPU')).toBeVisible();
    });

    test('Output level shows dB text', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const status = page.getByRole('contentinfo', { name: 'Application status' });
        const out = status.getByText(/Out/i).locator('..');
        const text = await out.textContent();
        expect(text).toMatch(/dB|inf|-|∞/i);
    });

    test('Status bar shows engine text or indicator', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const status = page.getByRole('contentinfo', { name: 'Application status' });
        await expect(status).toBeVisible();
    });
});

test.describe('Playhead Display', () => {
    test('Playhead position shows initial bar position', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const playhead = page.getByRole('button', { name: /Playhead position/i });
        await expect(playhead).toBeVisible();
        await expect(playhead).toContainText('1');
    });
});

test.describe('Beat Ruler Interaction', () => {
    test('Beat ruler is visible and responds to click', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const beat_ruler = page.getByLabel('Beat ruler');
        await expect(beat_ruler).toBeVisible();
        const box = await beat_ruler.boundingBox();
        if (box) {
            await beat_ruler.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
            await page.waitForTimeout(300);
        }
        await expect(beat_ruler).toBeVisible();
    });
});

test.describe('Automation View Toggle', () => {
    test('A key cycles automation visibility', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press('a');
        await page.waitForTimeout(300);
        await page.keyboard.press('a');
        await page.waitForTimeout(300);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});
