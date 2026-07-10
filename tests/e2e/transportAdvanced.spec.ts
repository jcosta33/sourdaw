import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Transport Advanced Controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can toggle the metronome and reveal its volume slider', async ({ page }) => {
        const metronome = page.getByRole('button', { name: 'Metronome' });
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        await expect(page.getByRole('slider', { name: /Metronome volume/ })).toBeVisible();

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('Can toggle loop mode', async ({ page }) => {
        const loop = page.getByRole('button', { name: 'Loop' });
        await expect(loop).toHaveAttribute('aria-pressed', 'false');

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'true');

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'false');
    });

    test('Can toggle punch in/out', async ({ page }) => {
        const punch = page.getByRole('button', { name: 'Punch in/out' });
        await expect(punch).toHaveAttribute('aria-pressed', 'false');

        await punch.click();
        await expect(punch).toHaveAttribute('aria-pressed', 'true');

        await punch.click();
        await expect(punch).toHaveAttribute('aria-pressed', 'false');
    });

    test('Can toggle count-in and cycle through bar values', async ({ page }) => {
        const count_in = page.getByRole('button', { name: 'Count-in', exact: true });
        await expect(count_in).toHaveAttribute('aria-pressed', 'false');

        await count_in.click();
        await expect(count_in).toHaveAttribute('aria-pressed', 'true');

        const bars = page.getByRole('button', { name: /Count-in bars/ });
        await expect(bars).toBeVisible();
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 1/));

        await bars.click({ force: true });
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 2/));

        await bars.click({ force: true });
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 4/));

        await bars.click({ force: true });
        await expect(bars).toHaveAttribute('aria-label', expect.stringMatching(/Count-in bars: 1/));
    });

    test('Can toggle auto-scroll (default on)', async ({ page }) => {
        const auto_scroll = page.getByRole('button', { name: 'Auto-scroll follows playhead' });
        await expect(auto_scroll).toHaveAttribute('aria-pressed', 'true');

        await auto_scroll.click();
        await expect(auto_scroll).toHaveAttribute('aria-pressed', 'false');

        await auto_scroll.click();
        await expect(auto_scroll).toHaveAttribute('aria-pressed', 'true');
    });

    test('Can switch solo mode between SIP, AFL, and PFL', async ({ page }) => {
        const solo_group = page.getByRole('radiogroup', { name: 'Solo mode' });

        await expect(solo_group.getByRole('radio', { name: 'SIP' })).toBeChecked();

        await solo_group.getByRole('radio', { name: 'AFL' }).click();
        await expect(solo_group.getByRole('radio', { name: 'AFL' })).toBeChecked();

        await solo_group.getByRole('radio', { name: 'PFL' }).click();
        await expect(solo_group.getByRole('radio', { name: 'PFL' })).toBeChecked();

        await solo_group.getByRole('radio', { name: 'SIP' }).click();
        await expect(solo_group.getByRole('radio', { name: 'SIP' })).toBeChecked();
    });

    test('Can select different editing tools', async ({ page }) => {
        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });

        await expect(tools.getByRole('radio', { name: 'Select (S)' })).toBeChecked();

        await tools.getByRole('radio', { name: 'Draw (D/B)' }).click();
        await expect(tools.getByRole('radio', { name: 'Draw (D/B)' })).toBeChecked();

        await tools.getByRole('radio', { name: 'Marquee (E)' }).click();
        await expect(tools.getByRole('radio', { name: 'Marquee (E)' })).toBeChecked();

        await tools.getByRole('radio', { name: 'Cut (C)' }).click();
        await expect(tools.getByRole('radio', { name: 'Cut (C)' })).toBeChecked();

        await tools.getByRole('radio', { name: 'Select (S)' }).click();
        await expect(tools.getByRole('radio', { name: 'Select (S)' })).toBeChecked();
    });

    test('Can toggle background capture', async ({ page }) => {
        const capture = page.getByRole('button', { name: 'Enable background capture' });
        await expect(capture).toHaveAttribute('aria-pressed', 'false');

        await capture.click();

        const capture_on = page.getByRole('button', { name: 'Disable background capture' });
        await expect(capture_on).toHaveAttribute('aria-pressed', 'true');
    });

    test('Can toggle ripple editing', async ({ page }) => {
        const ripple = page.getByRole('button', { name: 'Toggle ripple editing' });
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');

        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'true');

        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');
    });

    test('Undo button becomes enabled after an action', async ({ page }) => {
        const undo = page.getByRole('button', { name: 'Undo', exact: true });

        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();

        await expect(undo).toBeEnabled();
    });
});
