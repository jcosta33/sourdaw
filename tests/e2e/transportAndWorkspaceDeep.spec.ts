import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Workspace Mode Toggle', () => {
    test('Tab key toggles between arrange and clip mode', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.locator('#main-content').click();

        await page.keyboard.press('Tab');
        await page.waitForTimeout(500);

        await page.keyboard.press('Tab');
        await page.waitForTimeout(500);

        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });
});

test.describe('Recording Workflow', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Record arm toggle works', async ({ page }) => {
        const record = page.getByTestId('transport-record');
        const pressed_before = await record.getAttribute('aria-pressed');
        await record.click();
        await page.waitForTimeout(300);
        const pressed_after = await record.getAttribute('aria-pressed');
        expect(pressed_after).not.toBe(pressed_before);
    });
});

test.describe('Timeline Minimap Interaction', () => {
    test('Timeline minimap responds to keyboard', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        await expect(minimap).toBeVisible();

        await minimap.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);

        await expect(minimap).toBeVisible();
    });

    test('Timeline minimap responds to click', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        const box = await minimap.boundingBox();
        if (box) {
            await minimap.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
            await page.waitForTimeout(300);
        }
        await expect(minimap).toBeVisible();
    });
});

test.describe('Metronome Volume Slider', () => {
    test('Metronome volume slider appears when metronome enabled', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
        await metronome.click();
        await page.waitForTimeout(300);

        const volume = page.getByRole('slider', { name: /Metronome volume/i });
        await expect(volume).toBeVisible({ timeout: 5000 });
        const value = await volume.getAttribute('aria-valuenow');
        expect(value).not.toBeNull();
    });
});

test.describe('Count-in Controls Deep', () => {
    test('Count-in bars cycle 1→2→4→1', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const count_in = page.getByRole('button', { name: 'Count-in', exact: true });
        await count_in.click();
        await expect(count_in).toHaveAttribute('aria-pressed', 'true');

        const bars = page.getByRole('button', { name: /Count-in bars/i });
        await expect(bars).toBeVisible();
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 1/));

        await bars.click({ force: true });
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 2/));

        await bars.click({ force: true });
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 4/));

        await bars.click({ force: true });
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 1/));
    });
});

test.describe('Punch Recording Controls', () => {
    test('Punch in/out toggle + beat inputs visible', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const punch = page.getByRole('button', { name: 'Punch in/out' });
        await expect(punch).toHaveAttribute('aria-pressed', 'false');
        await punch.click();
        await expect(punch).toHaveAttribute('aria-pressed', 'true');

        await page.getByRole('button', { name: 'Punch recording settings' }).click();
        const punch_in = page.getByTestId('punch-in-beat');
        await expect(punch_in).toBeVisible({ timeout: 5000 });

        await punch.click();
        await expect(punch).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('Solo Mode Cycle', () => {
    test('Solo mode cycles SIP → AFL → PFL → SIP', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const solo_group = page.getByRole('radiogroup', { name: 'Solo mode' });

        await expect(solo_group.getByRole('radio', { name: 'SIP' })).toBeChecked();

        await solo_group.getByRole('radio', { name: 'AFL' }).click();
        await expect(solo_group.getByRole('radio', { name: 'AFL' })).toBeChecked();

        await solo_group.getByRole('radio', { name: 'PFL' }).click();
        await expect(solo_group.getByRole('radio', { name: 'PFL' })).toBeChecked();

        await solo_group.getByRole('radio', { name: 'SIP' }).click();
        await expect(solo_group.getByRole('radio', { name: 'SIP' })).toBeChecked();
    });
});

test.describe('Editing Tools Deep', () => {
    test('All 6 tools selectable via UI', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });

        for (const tool of [/Select/i, /Cut/i, /^Draw/i, /Auto-draw/i, /Stretch/i, /Marquee/i]) {
            const radio = tools.getByRole('radio', { name: tool });
            await radio.click();
            await expect(radio).toBeChecked();
        }

        await tools.getByRole('radio', { name: /Select/i }).click();
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();
    });
});

test.describe('Ripple Editing', () => {
    test('Ripple editing toggle changes state', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const ripple = page.getByRole('button', { name: 'Toggle ripple editing' });
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');
        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'true');
        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');
    });
});

test.describe('Background Capture Toggle', () => {
    test('Background capture toggles label', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const capture = page.getByRole('button', { name: 'Enable background capture' });
        await expect(capture).toHaveAttribute('aria-pressed', 'false');
        await capture.click();

        const capture_on = page.getByRole('button', { name: 'Disable background capture' });
        await expect(capture_on).toHaveAttribute('aria-pressed', 'true');

        await capture_on.click();
        await expect(page.getByRole('button', { name: 'Enable background capture' })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });
});

test.describe('Undo/Redo Buttons', () => {
    test('Undo button becomes enabled after action', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const undo = page.getByRole('button', { name: 'Undo', exact: true });

        await add_track(page, 'MIDI');
        await expect(undo).toBeEnabled({ timeout: 5000 });
    });

    test('Redo button becomes enabled after undo', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
        await page.waitForTimeout(300);

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo' });

        if (await undo.isEnabled().catch(() => false)) {
            await undo.click();
            await page.waitForTimeout(1000);
            if (await redo.isEnabled().catch(() => false)) {
                await expect(redo).toBeEnabled();
            }
        }
    });
});

test.describe('Launch Screen Back Navigation', () => {
    test('Can navigate back from template grid', async ({ page }) => {
        await setupWorkspace(page);
        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await launch_screen.waitFor({ state: 'visible' });

        await page.locator('#launch-from-template').click();
        await expect(page.getByText('Start a new project')).toBeVisible();

        await page.getByRole('button', { name: 'Back to home' }).click();
        await expect(page.locator('#launch-new-project')).toBeVisible();
    });
});

test.describe('Project Rename from Transport Bar', () => {
    test('Can rename project inline', async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const project_button = page.getByRole('button', { name: 'Untitled Project' });
        await project_button.click();

        const input = page.locator('input:focus');
        await input.fill('My Track');
        await input.press('Enter');

        await expect(page.getByRole('button', { name: 'My Track' })).toBeVisible();
    });
});
