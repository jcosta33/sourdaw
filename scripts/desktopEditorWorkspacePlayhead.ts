import assert from 'node:assert/strict';

import { type Locator, type Page } from 'playwright';

import { exactButton } from './desktopEditorFamilyDrive.ts';
import {
    pausePreservesProgress,
    renderedPlayheadBeat,
    type NativePauseEvidence,
    type NativeTransportPoll,
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
            ready: boolean;
            stopped: boolean;
        } = {
            readout: null,
            trusted: false,
            ageMs: null,
            clickTimeMs: null,
            changed: false,
            ready: false,
            stopped: false,
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
            witness.readout = readout.isConnected && readout.textContent === previous ? previous : null;
            witness.trusted = event.isTrusted;
            witness.ageMs = changedAt === null ? null : witness.clickTimeMs - changedAt;
        }
        const bridge: unknown = Reflect.get(globalThis, 'sourdaw');
        if (typeof bridge !== 'object' || bridge === null || typeof Reflect.get(bridge, 'invoke') !== 'function') {
            observer.disconnect();
            throw new Error('desktop bridge unavailable');
        }
        const call = Reflect.get(bridge, 'invoke') as (command: string, args: readonly unknown[]) => Promise<unknown>;
        const invokeBounded = async (command: string): Promise<unknown> => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                return await Promise.race([
                    call(command, []),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`${command} timeout`)), 5000);
                    }),
                ]);
            } finally {
                clearTimeout(timer);
            }
        };
        const evidence: NativePauseEvidence = {
            before: null,
            lastPlaying: null,
            parked: null,
            sampleRate: null,
            outputBufferFrames: null,
            failure: null,
        };
        const loop = (async () => {
            try {
                const installedAtMs = performance.now();
                while (
                    !witness.stopped &&
                    performance.now() <
                        (witness.clickTimeMs === null ? installedAtMs + 15000 : witness.clickTimeMs + 1500)
                ) {
                    const issuedAtMs = performance.now();
                    const payload = await invokeBounded('engine_transport_position');
                    const answeredAtMs = performance.now();
                    if (typeof payload !== 'object' || payload === null) throw new Error('invalid transport response');
                    if (
                        typeof Reflect.get(payload, 'running') !== 'boolean' ||
                        typeof Reflect.get(payload, 'playing') !== 'boolean'
                    )
                        throw new Error('invalid transport state');
                    const batchesApplied: unknown = Reflect.get(payload, 'batchesApplied');
                    if (typeof batchesApplied !== 'number') throw new Error('invalid native batch');
                    const poll: NativeTransportPoll = {
                        issuedAtMs,
                        answeredAtMs,
                        running: Reflect.get(payload, 'running') === true,
                        playing: Reflect.get(payload, 'playing') === true,
                        engineId: String(Reflect.get(payload, 'engineId')),
                        batchesApplied,
                    };
                    if (!witness.ready && (!poll.running || !poll.playing || !/^[1-9][0-9]*$/u.test(poll.engineId))) {
                        await new Promise<void>((resolve) => setTimeout(resolve, 12));
                        continue;
                    }
                    if (
                        !poll.running ||
                        !/^[1-9][0-9]*$/u.test(poll.engineId) ||
                        !Number.isSafeInteger(poll.batchesApplied) ||
                        poll.batchesApplied < 0 ||
                        (evidence.lastPlaying && poll.engineId !== evidence.lastPlaying.engineId)
                    ) {
                        throw new Error('native engine unavailable or changed');
                    }
                    if (poll.playing) {
                        evidence.lastPlaying = poll;
                        if (witness.clickTimeMs === null) {
                            evidence.before = poll;
                            witness.ready = true;
                        }
                    } else if (witness.clickTimeMs !== null) {
                        if (issuedAtMs >= witness.clickTimeMs) {
                            evidence.parked = poll;
                            break;
                        }
                    } else {
                        witness.ready = false;
                        evidence.before = null;
                        evidence.lastPlaying = null;
                    }
                    await new Promise<void>((resolve) => setTimeout(resolve, 12));
                }
                if (!witness.stopped && !evidence.parked) evidence.failure = 'native park not observed before deadline';
                if (!witness.stopped && evidence.parked) {
                    const diagnostics = await invokeBounded('engine_rt_diagnostics');
                    if (typeof diagnostics !== 'object' || diagnostics === null) throw new Error('invalid diagnostics');
                    const sampleRate: unknown = Reflect.get(diagnostics, 'sampleRate');
                    const outputBufferFrames: unknown = Reflect.get(diagnostics, 'outputBufferFrames');
                    if (typeof sampleRate !== 'number' || typeof outputBufferFrames !== 'number') {
                        throw new Error('invalid native callback diagnostics');
                    }
                    evidence.sampleRate = sampleRate;
                    evidence.outputBufferFrames = outputBufferFrames;
                }
            } catch (error) {
                evidence.failure = error instanceof Error ? error.message : String(error);
            }
            return evidence;
        })();
        button.addEventListener('click', sample, { capture: true, once: true });
        return {
            witness,
            loop,
            cleanup: () => {
                witness.stopped = true;
                observer.disconnect();
                button.removeEventListener('click', sample, true);
            },
        };
    });
    try {
        const witnessHandle = await capture.evaluateHandle(({ witness }) => witness);
        try {
            const ready = await page.waitForFunction((witness) => witness.changed && witness.ready, witnessHandle, {
                timeout: STEP_TIMEOUT_MS,
            });
            await ready.dispose();
        } finally {
            await witnessHandle.dispose();
        }
        await pause.click();
        const witness = await capture.evaluate(({ witness }) => witness);
        timeline.pauseCapture = { trusted: witness.trusted, ageMs: witness.ageMs, clickTimeMs: witness.clickTimeMs };
        timeline.nativePause = await capture.evaluate(async ({ loop }) => loop);
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
            timeline.nativePause ??= await capture.evaluate(async ({ loop }) => loop);
        } finally {
            await capture.dispose();
        }
    }
}
