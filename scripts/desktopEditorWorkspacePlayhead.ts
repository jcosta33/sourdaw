import assert from 'node:assert/strict';

import { type Locator, type Page } from 'playwright';

import { exactButton } from './desktopEditorFamilyDrive.ts';
import { pausePreservesProgress, renderedPlayheadBeat } from './desktopEditorWorkspaceEvidence.ts';

export async function playhead(page: Page): Promise<number> {
    const text = await page.getByTestId('transport-playhead').textContent();
    const beat = renderedPlayheadBeat(text ?? '');
    assert(beat !== null, 'missing rendered bars beats ticks');
    return beat;
}

export function heldReadingsMatch(values: string[], expected: number): boolean {
    return (
        values.length > 1 && values.every((value) => value === values[0] && renderedPlayheadBeat(value) === expected)
    );
}

export async function heldPlayhead(page: Page, expected: number): Promise<number> {
    // Observe every animation frame for a bounded stability window, rather than one immediate reading.
    const values = await page.getByTestId('transport-playhead').evaluate(async (element) => {
        const readings: string[] = [];
        const started = performance.now();
        do {
            readings.push(element.textContent);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        } while (performance.now() - started < 400);
        return readings;
    });
    assert(heldReadingsMatch(values, expected));
    assert.equal(await playhead(page), expected);
    return values.length;
}

export async function pauseAtClick(
    page: Page,
    playback: Locator,
    advanced: number,
    samples: Record<string, number>
): Promise<number> {
    const pause = exactButton(playback, 'Pause');
    const capture = await pause.evaluateHandle((button) => {
        const witness: { readout: string | null } = { readout: null };
        function sample(): void {
            witness.readout = document.querySelector('[data-testid="transport-playhead"]')?.textContent ?? null;
        }
        // Native target capture runs before React's delegated bubble action changes transport state.
        button.addEventListener('click', sample, { capture: true, once: true });
        return { witness, cleanup: () => button.removeEventListener('click', sample, true) };
    });
    try {
        await pause.click();
        const clickReadout = await capture.evaluate(({ witness }) => witness.readout);
        const clicked = renderedPlayheadBeat(clickReadout ?? '');
        if (clicked !== null) {
            samples.pauseClick = clicked;
        }
        await exactButton(playback, 'Play').waitFor({ state: 'visible' });
        const paused = await playhead(page);
        samples.paused = paused;
        assert(pausePreservesProgress(advanced, clickReadout, paused), 'Pause did not park at its click position');
        return paused;
    } finally {
        try {
            await capture.evaluate(({ cleanup }) => cleanup());
        } finally {
            await capture.dispose();
        }
    }
}
