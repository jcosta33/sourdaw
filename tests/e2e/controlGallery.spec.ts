import { expect, test } from '@playwright/test';

import { LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS, launch_new_project, setupWorkspace } from './e2eUtils';

test('development control gallery shows source tokens and interactive shared controls', async ({ page }, testInfo) => {
    await setupWorkspace(page);
    await launch_new_project(page);
    await page.goto('/dev/control-gallery');
    const galleryHeading = page.getByRole('heading', { name: 'Sourdaw control gallery' });
    expect(await page.locator('script[type="module"][src^="/src/"]').count()).toBeGreaterThan(0);
    // The direct navigation starts a new application boot, including cold dev-server transforms.
    await expect(galleryHeading).toBeVisible({ timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS });

    const tokens = page.getByRole('list', { name: 'Design tokens' }).locator('[data-token-name]');
    await expect(tokens).toHaveCount(193);

    for (const category of ['Knob', 'Fader', 'Toggle', 'LED', 'Meter', 'Display']) {
        await expect(page.getByRole('region', { name: category })).toBeVisible();
    }

    const toggle = page.getByRole('button', { name: 'Gallery bypass' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Bypassed')).toBeVisible();

    const knob = page.getByRole('slider', { name: 'Width' });
    const knobValue = page.getByLabel('Knob value');
    const beforeKnob = await knobValue.textContent();
    await knob.focus();
    await page.keyboard.press('ArrowUp');
    await expect(knobValue).not.toHaveText(beforeKnob ?? '');

    const fader = page.getByRole('slider', { name: 'Gallery gain fader' });
    const faderValue = page.getByLabel('Fader value');
    const track = fader.locator('[data-role="fader-track"]');
    const trackBox = await track.boundingBox();
    expect(trackBox).not.toBeNull();
    if (trackBox === null) {
        return;
    }
    await track.click({ position: { x: trackBox.width / 2, y: trackBox.height * 0.85 } });
    expect(Number(await fader.getAttribute('aria-valuenow'))).toBeLessThan(1);
    await expect(fader).toHaveAttribute('aria-valuetext', /dB$/);
    await track.click({ position: { x: trackBox.width / 2, y: trackBox.height * 0.3 } });
    expect(Number(await fader.getAttribute('aria-valuenow'))).toBeCloseTo(1, 1);
    await expect(fader).toHaveAttribute('aria-valuetext', /^-?0\.\d dB$/);
    await track.click({ position: { x: trackBox.width / 2, y: trackBox.height * 0.1 } });
    expect(Number(await fader.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
    await expect(fader).toHaveAttribute('aria-valuetext', /dB$/);

    const beforeFader = await faderValue.textContent();
    await fader.focus();
    await page.keyboard.press('ArrowUp');
    await expect(faderValue).not.toHaveText(beforeFader ?? '');
    await expect(fader).toHaveAttribute('aria-valuetext', /dB$/);
    await expect(page.getByText('Unity: 1.0 at 70% throw')).toBeVisible();
    await testInfo.attach('control-gallery', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
    });
});
