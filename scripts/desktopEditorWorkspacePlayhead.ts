import assert from 'node:assert/strict';

import { type JSHandle, type Locator, type Page } from 'playwright';

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

type PauseWitness = {
    readout: string | null;
    trusted: boolean;
    ageMs: number | null;
    clickTimeMs: number | null;
    changed: boolean;
    ready: boolean;
    stopped: boolean;
};

function installRenderedPause(button: HTMLElement) {
    const candidate = document.querySelector('[data-testid="transport-playhead"]');
    if (!candidate) {
        throw new Error('missing rendered playhead');
    }
    const readout = candidate;
    const witness: PauseWitness = {
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
    button.addEventListener('click', sample, { capture: true, once: true });
    return {
        witness,
        cleanup: () => {
            observer.disconnect();
            button.removeEventListener('click', sample, true);
        },
    };
}

function installNativeReader() {
    const bridge: unknown = Reflect.get(globalThis, 'sourdaw');
    if (typeof bridge !== 'object' || bridge === null || typeof Reflect.get(bridge, 'invoke') !== 'function') {
        throw new Error('desktop bridge unavailable');
    }
    const call = Reflect.get(bridge, 'invoke') as (command: string, args: readonly unknown[]) => Promise<unknown>;
    async function invoke(command: string): Promise<unknown> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                call(command, []),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(`${command} timeout`)), 5000);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
    async function poll(): Promise<NativeTransportPoll> {
        const issuedAtMs = performance.now();
        const payload = await invoke('engine_transport_position');
        const answeredAtMs = performance.now();
        if (typeof payload !== 'object' || payload === null) {
            throw new TypeError('invalid transport response');
        }
        if (
            typeof Reflect.get(payload, 'running') !== 'boolean' ||
            typeof Reflect.get(payload, 'playing') !== 'boolean'
        ) {
            throw new TypeError('invalid transport state');
        }
        const batchesApplied: unknown = Reflect.get(payload, 'batchesApplied');
        if (typeof batchesApplied !== 'number') {
            throw new TypeError('invalid native batch');
        }
        const playheadFrame: unknown = Reflect.get(payload, 'playheadFrame');
        if (typeof playheadFrame !== 'number' || !Number.isSafeInteger(playheadFrame) || playheadFrame < 0) {
            throw new TypeError('invalid native playhead frame');
        }
        return {
            playheadFrame,
            issuedAtMs,
            answeredAtMs,
            running: Reflect.get(payload, 'running') === true,
            playing: Reflect.get(payload, 'playing') === true,
            engineId: String(Reflect.get(payload, 'engineId')),
            batchesApplied,
        };
    }
    return { poll };
}

function installNativePause({
    witness,
    reader,
}: {
    witness: PauseWitness;
    reader: ReturnType<typeof installNativeReader>;
}) {
    const evidence: NativePauseEvidence = {
        before: null,
        lastPlaying: null,
        parked: null,
        advanceFrom: null,
        advanceTo: null,
        failure: null,
    };
    function record(poll: NativeTransportPoll): boolean {
        if (!witness.ready && (!poll.running || !poll.playing || !/^[1-9][0-9]*$/u.test(poll.engineId))) {
            return false;
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
            const previous = evidence.lastPlaying;
            if (previous && poll.playheadFrame > previous.playheadFrame) {
                evidence.advanceFrom = previous;
                evidence.advanceTo = poll;
            }
            evidence.lastPlaying = poll;
            if (witness.clickTimeMs === null) {
                evidence.before = poll;
                witness.ready = true;
            }
        } else if (witness.clickTimeMs !== null) {
            if (poll.issuedAtMs >= witness.clickTimeMs) {
                evidence.parked = poll;
                return true;
            }
        } else {
            witness.ready = false;
            evidence.before = null;
            evidence.lastPlaying = null;
            evidence.advanceFrom = null;
            evidence.advanceTo = null;
        }
        return false;
    }
    const loop = (async () => {
        try {
            const installedAtMs = performance.now();
            while (
                !witness.stopped &&
                performance.now() < (witness.clickTimeMs === null ? installedAtMs + 15000 : witness.clickTimeMs + 1500)
            ) {
                if (record(await reader.poll())) {
                    break;
                }
                await new Promise<void>((resolve) => setTimeout(resolve, 12));
            }
            if (!witness.stopped && !evidence.parked) {
                evidence.failure = 'native park not observed before deadline';
            }
        } catch (error) {
            evidence.failure = error instanceof Error ? error.message : String(error);
        }
        return evidence;
    })();
    return {
        loop,
        cleanup: () => {
            witness.stopped = true;
            if (!witness.ready && !evidence.failure) {
                evidence.failure = 'native roll not observed before click timeout';
            }
        },
    };
}

export async function pauseAtClick(
    page: Page,
    playback: Locator,
    advanced: number,
    timeline: NonNullable<WorkspaceObservation['timeline']>
): Promise<number> {
    const pause = exactButton(playback, 'Pause');
    timeline.pauseCapture = { trusted: false, ageMs: null, clickTimeMs: null };
    const capture = await pause.evaluateHandle(installRenderedPause);
    try {
        const witnessHandle = await capture.evaluateHandle(({ witness }) => witness);
        try {
            const reader = await page.evaluateHandle(installNativeReader);
            try {
                const native = await page.evaluateHandle(installNativePause, { witness: witnessHandle, reader });
                try {
                    return await measurePause(page, pause, playback, advanced, timeline, witnessHandle, native);
                } finally {
                    await native.evaluate(({ cleanup }) => cleanup());
                    timeline.nativePause ??= await native.evaluate(async ({ loop }) => loop);
                    await native.dispose();
                }
            } finally {
                await reader.dispose();
            }
        } finally {
            await witnessHandle.dispose();
        }
    } catch (error) {
        timeline.nativePause ??= {
            before: null,
            lastPlaying: null,
            parked: null,
            advanceFrom: null,
            advanceTo: null,
            failure: error instanceof Error ? error.message : String(error),
        };
        throw error;
    } finally {
        await capture.evaluate(({ cleanup }) => cleanup());
        await capture.dispose();
    }
}

async function measurePause(
    page: Page,
    pause: Locator,
    playback: Locator,
    advanced: number,
    timeline: NonNullable<WorkspaceObservation['timeline']>,
    witnessHandle: JSHandle<PauseWitness>,
    native: JSHandle<ReturnType<typeof installNativePause>>
): Promise<number> {
    const ready = await page.waitForFunction((witness) => witness.changed && witness.ready, witnessHandle, {
        timeout: STEP_TIMEOUT_MS,
    });
    await ready.dispose();
    await pause.click();
    const witness = await witnessHandle.jsonValue();
    timeline.pauseCapture = {
        trusted: witness.trusted,
        ageMs: witness.ageMs,
        clickTimeMs: witness.clickTimeMs,
    };
    timeline.nativePause = await native.evaluate(async ({ loop }) => loop);
    const clicked = renderedPlayheadBeat(witness.readout ?? '');
    if (clicked !== null) {
        timeline.samples.pauseClick = clicked;
    }
    await exactButton(playback, 'Play').waitFor({ state: 'visible' });
    const paused = await playhead(page);
    timeline.samples.paused = paused;
    assert(pausePreservesProgress(advanced, witness.readout, paused), 'Pause did not park at its click position');
    return paused;
}
