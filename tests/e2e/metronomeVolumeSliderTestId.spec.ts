import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * The metronome toggle revealing a volume slider is covered elsewhere
 * (transportAdvanced.spec.ts, transportAndWorkspaceDeep.spec.ts), but those
 * specs only assert the slider exists (`aria-valuenow` not null) — a
 * pure-existence check that passes for any value. This spec covers the real
 * gap: the slider's value actually changes on keyboard input.
 *
 * The slider is a Radix UI thumb (`<span role="slider">`), not a native range
 * input, so `inputValue()` does not apply. The thumb's aria-label is a computed
 * readout (`Metronome volume: N%`, derived from `metronomeVolume`), so asserting
 * it changes is a faithful, non-bogus state-change assertion.
 */
test.describe('Transport metronome volume slider', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Metronome volume slider value increases on ArrowUp', async ({ page }) => {
        const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        const slider = page.getByRole('slider', { name: /Metronome volume/ });
        await expect(slider).toBeVisible();

        // Default metronomeVolume is 0.5 (TransportState default); step is 0.01.
        await expect(slider).toHaveAttribute('aria-label', 'Metronome volume: 50%');

        await slider.press('ArrowUp');

        // One ArrowUp increments the controlled value by one step (0.5 -> 0.51),
        // which round-trips through setMetronomeVolume and re-renders the label.
        await expect(slider).toHaveAttribute('aria-label', 'Metronome volume: 51%');

        // A second step proves this is a real accumulating state change, not a
        // one-shot toggle.
        await slider.press('ArrowUp');
        await expect(slider).toHaveAttribute('aria-label', 'Metronome volume: 52%');
    });
});
