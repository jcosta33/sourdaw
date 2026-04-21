/**
 * Sequencer playback — advances the step sequencer synchronized to AudioContext time.
 * Uses setTimeout with AudioContext clock correction to avoid setInterval drift.
 * Handles: step triggers, probability, conditional triggers, swing, ratcheting, param locks.
 */

import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { type Step, type Pattern } from '../models/ToasterKit';
import { toasterStore } from '../stores/toasterStore';

import { TOASTER_ENGINE_MAP } from './loadToasterKit';
import { morphPatterns } from './patternMorph';
import { getFirstToasterDeviceId } from './toasterParamBridge/getFirstToasterDeviceId';
import { setPadEngineImmediate } from './toasterParamBridge/setPadEngineImmediate';
import { setToasterPadParam } from './toasterParamBridge/setToasterPadParam';
import { triggerToasterPad } from './triggerPad';

// §62.1 — Coalesce 5 module-level mutables into a single holder so the
// playback session lives behind one named handle. Mutation still happens
// through named setters, so importers can't reassign \`running = true\`
// from outside this module.
const sequencerState = {
    running: false,
    fillActive: false,
    playCount: 0,
    /** AudioContext time of the next step tick. */
    nextTickTime: 0,
    timeoutId: null as ReturnType<typeof setTimeout> | null,
};

export function setFillActive(active: boolean): void {
    sequencerState.fillActive = active;
}

function shouldTrigger(step: Step, loopIndex: number): boolean {
    if (!step.active) {
        return false;
    }

    switch (step.condition) {
        case 'fill':
            if (!sequencerState.fillActive) {
                return false;
            }
            break;
        case 'not-fill':
            if (sequencerState.fillActive) {
                return false;
            }
            break;
        case 'first':
            if (loopIndex > 0) {
                return false;
            }
            break;
        case 'not-first':
            if (loopIndex === 0) {
                return false;
            }
            break;
        default:
            break;
    }

    if (step.probability < 1 && Math.random() > step.probability) {
        return false;
    }

    return true;
}

function tick(currentStep: number, bpm: number, stepsPerBeat: number): void {
    if (!sequencerState.running) {
        return;
    }

    const state = toasterStore.value;
    if (!state) {
        return;
    }

    const sourcePattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!sourcePattern) {
        return;
    }

    let pattern: Pattern = sourcePattern;
    if (state.morph.enabled && state.morph.targetPatternId) {
        const targetPattern = state.kit.patterns.find((p) => p.id === state.morph.targetPatternId);
        if (targetPattern) {
            pattern = morphPatterns(sourcePattern, targetPattern, state.morph.position);
        }
    }

    const totalSteps = pattern.stepsPerBar * pattern.bars;
    const stepDurationMs = 60_000 / bpm / stepsPerBeat;

    const toasterDeviceId = getFirstToasterDeviceId();

    for (const track of pattern.tracks) {
        const trackSteps = track.stepsOverride ?? totalSteps;
        const stepIdx = currentStep % trackSteps;
        const step = track.steps[stepIdx];
        if (!step) {
            continue;
        }
        if (!shouldTrigger(step, sequencerState.playCount)) {
            continue;
        }

        const vel = Math.round(step.velocity * 127);

        const pad = state.kit.pads[track.padIndex];
        if (step.soundLock && pad && toasterDeviceId) {
            const lockIdx = TOASTER_ENGINE_MAP[step.soundLock] ?? 0;
            setPadEngineImmediate(toasterDeviceId, track.padIndex, lockIdx);
        }

        if (toasterDeviceId) {
            const locks = step.paramLocks;
            for (const [key, value] of Object.entries(locks)) {
                if (key.startsWith('_')) {
                    continue;
                }
                setToasterPadParam(
                    toasterDeviceId,
                    track.padIndex,
                    key as keyof import('../models/ToasterKit').PadState,
                    value
                );
            }
        }

        const microOffsetMs = step.microTiming * stepDurationMs;
        const swingMs = stepIdx % 2 === 1 ? state.kit.swing * stepDurationMs * 0.5 : 0;
        const totalDelayMs = Math.max(0, swingMs + microOffsetMs);

        function fire(): void {
            triggerToasterPad(track.padIndex, vel);
            if (step.soundLock && pad && toasterDeviceId) {
                const defaultIdx = TOASTER_ENGINE_MAP[pad.engineType] ?? 0;
                setPadEngineImmediate(toasterDeviceId, track.padIndex, defaultIdx);
            }
        }

        if (totalDelayMs > 1) {
            setTimeout(fire, totalDelayMs);
        } else {
            fire();
        }

        if (step.retriggerCount > 0) {
            const subInterval = stepDurationMs / (step.retriggerCount + 1);
            for (let r = 1; r <= step.retriggerCount; r++) {
                const retrigVel = Math.max(20, Math.round(vel * (1 - r * 0.12)));
                setTimeout(() => triggerToasterPad(track.padIndex, retrigVel), totalDelayMs + subInterval * r);
            }
        }
    }

    toasterStore.set({ ...state, currentStep, isPlaying: true });

    const stepDurationSec = stepDurationMs / 1000;
    const nextStep = (currentStep + 1) % totalSteps;
    if (nextStep === 0) {
        sequencerState.playCount++;
    }

    sequencerState.nextTickTime += stepDurationSec;
    const now = getAudioTime();
    const delayMs = Math.max(1, (sequencerState.nextTickTime - now) * 1000);

    sequencerState.timeoutId = setTimeout(() => tick(nextStep, bpm, stepsPerBeat), delayMs);
}

export function startSequencer(bpm: number, stepsPerBeat: number = 4): void {
    stopSequencer();
    sequencerState.running = true;
    sequencerState.playCount = 0;
    sequencerState.nextTickTime = getAudioTime();
    tick(0, bpm, stepsPerBeat);
}

export function stopSequencer(): void {
    sequencerState.running = false;
    if (sequencerState.timeoutId !== null) {
        clearTimeout(sequencerState.timeoutId);
        sequencerState.timeoutId = null;
    }
    const state = toasterStore.value;
    if (state) {
        toasterStore.set({ ...state, isPlaying: false, currentStep: 0 });
    }
    sequencerState.playCount = 0;
}
