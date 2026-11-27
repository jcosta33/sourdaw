import assert from 'node:assert/strict';

import { type Locator, type Page } from 'playwright';

import { exactButton } from './desktopEditorFamilyDrive.ts';
import {
    pausePreservesProgress,
    renderedPlayheadBeat,
    type WorkspaceObservation,
} from './desktopEditorWorkspaceEvidence.ts';
import { STEP_TIMEOUT_MS } from './packagedAppSession.ts';

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
    timeline: NonNullable<WorkspaceObservation['timeline']>
): Promise<number> {
    const pause = exactButton(playback, 'Pause');
    timeline.pauseCapture = { trusted: false, ageMs: null, clickTimeMs: null };
    const capture = await pause.evaluateHandle((button) => {
        const readout = document.querySelector('[data-testid="transport-playhead"]');
        if (!readout) throw new Error('missing rendered playhead');
        const witness: {
            readout: string | null;
            trusted: boolean;
            ageMs: number | null;
            clickTimeMs: number | null;
            changed: boolean;
        } = {
            readout: null,
            trusted: false,
            ageMs: null,
            clickTimeMs: null,
            changed: false,
        };
        let previous = readout.textContent;
        let changedAt: number | null = null;
        const observer = new MutationObserver(() => {
            const current = readout.textContent;
            if (current !== previous) {
                previous = current;
                changedAt = performance.now();
                witness.changed = true;
            }
        });
        observer.observe(readout, { subtree: true, childList: true, characterData: true });
        function sample(event: Event): void {
            witness.clickTimeMs = performance.now();
            witness.readout = readout.textContent;
            witness.trusted = event.isTrusted;
            witness.ageMs = changedAt === null ? null : witness.clickTimeMs - changedAt;
        }
        button.addEventListener('click', sample, { capture: true, once: true });
        return {
            witness,
            cleanup: () => {
                observer.disconnect();
                button.removeEventListener('click', sample, true);
            },
        };
    });
    try {
        const witnessHandle = await capture.evaluateHandle(({ witness }) => witness);
        try {
            await page.waitForFunction((witness) => witness.changed, witnessHandle, { timeout: STEP_TIMEOUT_MS });
        } finally {
            await witnessHandle.dispose();
        }
        await pause.click();
        const witness = await capture.evaluate(({ witness }) => witness);
        timeline.pauseCapture = { trusted: witness.trusted, ageMs: witness.ageMs, clickTimeMs: witness.clickTimeMs };
        const clickReadout = witness.readout;
        const { samples } = timeline;
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
