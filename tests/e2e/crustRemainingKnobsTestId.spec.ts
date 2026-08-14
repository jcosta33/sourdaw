import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// The last uncovered interactive surfaces of the Crust panel, all inside
// CrustControlZone's level sub-panels plus the metering strip's TP reset:
//   L1  style tiles (patch.style)
//   L2  algorithm pills (patch.algorithm)
//   L3  saturation section (satEnabled / satAlgorithm / satDrive / satMix)
//       + the L3 DELTA / A=B switches (the footer *chips* are covered by
//       crustUnityDeltaTestId.spec.ts; these role="switch" duplicates were not)
//   L4  multi-band + stereo chips, SC HPF switch + knob, dither select and
//       output bit-depth chips
//   *   the metering strip's "Reset true peak indicator" button
// (uiLevel L1/L2 chips are covered by crustLevelChipsTestId.spec.ts; L5 adds
// only a read-only statistics group.)
//
// Same verified interaction hazards as the sibling crust specs: Space is the
// global transport shortcut, and parts of the control zone can sit under the
// "Mission control" waveform card, so control-zone clicks go through
// dispatchEvent('click') — a real click event that bubbles to React's root
// listener and runs the actual onClick handler.
test.describe('Crust remaining knobs — level-gated controls flip their a11y state', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('L1 style tiles — selecting PUNCHY flips aria-pressed', async ({ page }) => {
        await page.getByRole('button', { name: 'L1', exact: true }).click();
        await page.waitForTimeout(300);

        // Default patch.style is 'transparent' (CrustPatch.ts).
        const transparent = page.getByRole('button', { name: /TRANSPARENT/ });
        const punchy = page.getByRole('button', { name: /PUNCHY/ });
        await expect(transparent).toHaveAttribute('aria-pressed', 'true');
        await expect(punchy).toHaveAttribute('aria-pressed', 'false');

        await punchy.dispatchEvent('click');
        await page.waitForTimeout(300);

        await expect(punchy).toHaveAttribute('aria-pressed', 'true');
        await expect(transparent).toHaveAttribute('aria-pressed', 'false');
    });

    test('L2 algorithm pills — selecting Dynamic flips aria-pressed and the description', async ({ page }) => {
        const transparent = page.getByRole('button', { name: 'Transparent', exact: true });
        const dynamic = page.getByRole('button', { name: 'Dynamic', exact: true });

        // Default patch.algorithm is 'transparent'; its description renders.
        await expect(transparent).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Clean ceiling, no color')).toBeVisible();

        await dynamic.dispatchEvent('click');
        await page.waitForTimeout(300);

        await expect(dynamic).toHaveAttribute('aria-pressed', 'true');
        await expect(transparent).not.toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Enhances transients')).toBeVisible();
    });

    test('L3 saturation — enable switch unblocks algorithm chips and updates the curve', async ({ page }) => {
        await page.getByRole('button', { name: 'L3', exact: true }).click();
        await page.waitForTimeout(300);

        // Default satEnabled is false: the switch rests off and the sat
        // algorithm chips are natively disabled.
        const satSwitch = page.locator('#crust-sat-enabled');
        await expect(satSwitch).toHaveAttribute('aria-checked', 'false');

        const tape = page.getByRole('button', { name: 'tape', exact: true });
        await expect(tape).toBeDisabled();

        await satSwitch.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(satSwitch).toHaveAttribute('aria-checked', 'true');
        await expect(tape).toBeEnabled();

        // Default satAlgorithm is 'soft'; the transfer curve's aria-label
        // follows the selected algorithm.
        await expect(page.getByRole('button', { name: 'soft', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[aria-label^="Saturation transfer curve:"]')).toHaveAttribute(
            'aria-label',
            'Saturation transfer curve: soft'
        );

        await tape.dispatchEvent('click');
        await page.waitForTimeout(300);

        await expect(tape).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'soft', exact: true })).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('[aria-label^="Saturation transfer curve:"]')).toHaveAttribute(
            'aria-label',
            'Saturation transfer curve: tape'
        );

        // The L3 DELTA switch (role="switch", distinct from the covered footer
        // chip) round-trips aria-checked.
        const deltaSwitch = page.getByRole('switch', { name: 'DELTA', exact: true });
        await expect(deltaSwitch).toHaveAttribute('aria-checked', 'false');
        await deltaSwitch.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(deltaSwitch).toHaveAttribute('aria-checked', 'true');
    });

    test('L3 saturation knobs — ArrowUp moves Drive and Mix aria-valuenow', async ({ page }) => {
        await page.getByRole('button', { name: 'L3', exact: true }).click();
        await page.waitForTimeout(300);

        const satSwitch = page.locator('#crust-sat-enabled');
        await satSwitch.dispatchEvent('click');
        await page.waitForTimeout(300);

        // The RotaryKnobs expose no aria-label ("Parameter control" fallback),
        // so each is scoped through its uniquely-named caption span — the knob
        // wrapper div holds both the caption and the role="slider".
        const driveSlider = page.getByText('Drive', { exact: true }).locator('xpath=..').getByRole('slider');
        const mixSlider = page.getByText('Mix', { exact: true }).locator('xpath=..').getByRole('slider');

        // Defaults satDrive 0 / satMix 0 (CrustPatch.ts). ArrowUp steps by the
        // knob's step (0.1 dB / 1 %).
        await expect(driveSlider).toHaveAttribute('aria-valuenow', '0');
        await expect(mixSlider).toHaveAttribute('aria-valuenow', '0');

        await driveSlider.press('ArrowUp');
        await page.waitForTimeout(300);
        const driveAfter = await driveSlider.getAttribute('aria-valuenow');
        expect(Number(driveAfter)).toBeGreaterThan(0);

        await mixSlider.press('ArrowUp');
        await page.waitForTimeout(300);
        const mixAfter = await mixSlider.getAttribute('aria-valuenow');
        expect(Number(mixAfter)).toBeGreaterThan(0);
    });

    test('L4 route row — multiband, stereo, SC HPF, dither and bit depth', async ({ page }) => {
        await page.getByRole('button', { name: 'L4', exact: true }).click();
        await page.waitForTimeout(300);

        // Multi-band: default 'wideband'.
        const wide = page.getByRole('button', { name: 'Wide', exact: true });
        const threeBand = page.getByRole('button', { name: '3band', exact: true });
        await expect(wide).toHaveAttribute('aria-pressed', 'true');
        await threeBand.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(threeBand).toHaveAttribute('aria-pressed', 'true');
        await expect(wide).not.toHaveAttribute('aria-pressed', 'true');

        // Stereo mode: default 'stereo'.
        const stereo = page.getByRole('button', { name: 'STEREO', exact: true });
        const ms = page.getByRole('button', { name: 'MS', exact: true });
        await expect(stereo).toHaveAttribute('aria-pressed', 'true');
        await ms.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(ms).toHaveAttribute('aria-pressed', 'true');
        await expect(stereo).not.toHaveAttribute('aria-pressed', 'true');

        // Sidechain HPF: enabling the switch reveals the frequency knob
        // (default scHpfFreq 60, step 1 Hz).
        const scHpfSwitch = page.locator('#crust-sc-hpf');
        await expect(scHpfSwitch).toHaveAttribute('aria-checked', 'false');
        const hpfSlider = page.getByText('HPF', { exact: true }).locator('xpath=..').getByRole('slider');
        await expect(hpfSlider).toHaveCount(0);

        await scHpfSwitch.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(scHpfSwitch).toHaveAttribute('aria-checked', 'true');

        const hpfSliderAfter = page.getByText('HPF', { exact: true }).locator('xpath=..').getByRole('slider');
        await expect(hpfSliderAfter).toHaveAttribute('aria-valuenow', '60');
        await hpfSliderAfter.press('ArrowUp');
        await page.waitForTimeout(300);
        const hpfAfter = await hpfSliderAfter.getAttribute('aria-valuenow');
        expect(Number(hpfAfter)).toBeGreaterThan(60);

        // Dither: default 'off' hides the bit-depth chips; selecting a dither
        // mode reveals them and lets the depth be switched (default 24).
        const ditherSelect = page.getByRole('combobox', { name: 'Dither mode' });
        await expect(ditherSelect).toHaveValue('off');
        const bitDepth32 = page.getByRole('button', { name: '32-bit', exact: true });
        await expect(bitDepth32).toHaveCount(0);

        await ditherSelect.selectOption('tpdf24');
        await page.waitForTimeout(300);
        await expect(ditherSelect).toHaveValue('tpdf24');

        await expect(page.getByRole('button', { name: '24-bit', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await bitDepth32.dispatchEvent('click');
        await page.waitForTimeout(300);
        await expect(bitDepth32).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: '24-bit', exact: true })).not.toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    test('metering strip — Reset true peak indicator click completes and holds the floor', async ({ page }) => {
        // The harness chain has no audio source, so the TP readout rests at its
        // floor ('—', truepeakMax = -100) and the LED reads Clear. The decisive
        // contract is the same as crustResetMetersTestId: the click dispatches
        // without error and the panel (plus the floor) survives it — a crash in
        // resetCrustTruePeakIndicator would unmount the panel.
        const resetTp = page.getByRole('button', { name: 'Reset true peak indicator' });
        await expect(resetTp).toBeVisible();

        await resetTp.dispatchEvent('click');
        await page.waitForTimeout(250);

        await expect(page.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await expect(page.getByText('Clear', { exact: true })).toBeVisible();
        await expect(resetTp).toBeVisible();
    });
});
