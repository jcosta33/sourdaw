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
type SequencerState = {
    running: boolean;
    fillActive: boolean;
    playCount: number;
    nextTickTime: number;
    timeoutId: ReturnType<typeof setTimeout> | null;
};

const sequencerStates = new Map<string, SequencerState>();

function getSeqState(deviceId: string): SequencerState {
    let state = sequencerStates.get(deviceId);
    if (!state) {
        state = {
            running: false,
            fillActive: false,
            playCount: 0,
            nextTickTime: 0,
            timeoutId: null,
        };
        sequencerStates.set(deviceId, state);
    }
    return state;
}

export function setFillActive(deviceId: string, active: boolean): void {
    getSeqState(deviceId).fillActive = active;
}

function shouldTrigger(deviceId: string, step: Step, loopIndex: number): boolean {
    if (!step.active) {
        return false;
    }

    const seqState = getSeqState(deviceId);

    switch (step.condition) {
        case 'always':
            break;
        case 'fill':
            if (!seqState.fillActive) {
                return false;
            }
            break;
        case 'not-fill':
            if (seqState.fillActive) {
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

function tick(deviceId: string, currentStep: number, bpm: number, stepsPerBeat: number): void {
    const seqState = getSeqState(deviceId);
    if (!seqState.running) {
        return;
    }

    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return;
    }

    const sourcePattern = state.kit.patterns.find((param) => param.id === state.kit.activePatternId);
    if (!sourcePattern) {
        return;
    }

    let pattern: Pattern = sourcePattern;
    if (state.morph.enabled && state.morph.targetPatternId) {
        const targetPattern = state.kit.patterns.find((param) => param.id === state.morph.targetPatternId);
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
        if (!shouldTrigger(deviceId, step, seqState.playCount)) {
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

        const fire = () => {
            triggerToasterPad(deviceId, track.padIndex, vel);
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
                setTimeout(() => triggerToasterPad(deviceId, track.padIndex, retrigVel), totalDelayMs + subInterval * r);
            }
        }
    }

    toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, currentStep, isPlaying: true } });

    const stepDurationSec = stepDurationMs / 1000;
    const nextStep = (currentStep + 1) % totalSteps;
    if (nextStep === 0) {
        seqState.playCount++;
    }

    seqState.nextTickTime += stepDurationSec;
    const now = getAudioTime();
    const delayMs = Math.max(1, (seqState.nextTickTime - now) * 1000);

    seqState.timeoutId = setTimeout(() => tick(deviceId, nextStep, bpm, stepsPerBeat), delayMs);
}

export function startSequencer(deviceId: string, bpm: number, stepsPerBeat: number = 4): void {
    stopSequencer(deviceId);
    const seqState = getSeqState(deviceId);
    seqState.running = true;
    seqState.playCount = 0;
    seqState.nextTickTime = getAudioTime();
    tick(deviceId, 0, bpm, stepsPerBeat);
}

export function stopSequencer(deviceId: string): void {
    const seqState = getSeqState(deviceId);
    seqState.running = false;
    if (seqState.timeoutId !== null) {
        clearTimeout(seqState.timeoutId);
        seqState.timeoutId = null;
    }
    const state = toasterStore.value?.[deviceId];
    if (state) {
        toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, isPlaying: false, currentStep: 0 } });
    }
    seqState.playCount = 0;
}
