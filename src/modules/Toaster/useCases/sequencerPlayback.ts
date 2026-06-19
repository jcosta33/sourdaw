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
    // Microtiming / retrigger fires scheduled by ticks. Tracked per device so
    // stopSequencer can cancel ghost hits that would otherwise fire after Stop
    // (clearing the next-tick timeoutId alone leaves these armed).
    pendingFireIds: Set<ReturnType<typeof setTimeout>>;
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
            pendingFireIds: new Set(),
        };
        sequencerStates.set(deviceId, state);
    }
    return state;
}

// Schedule a delayed fire whose id is tracked in the device's pendingFireIds
// so stopSequencer can cancel it. The id is removed once it runs.
function scheduleTrackedFire(seqState: SequencerState, fn: () => void, delayMs: number): void {
    const id = setTimeout(() => {
        seqState.pendingFireIds.delete(id);
        fn();
    }, delayMs);
    seqState.pendingFireIds.add(id);
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

        // Param locks are immediate (no delay), so route them now to this
        // sequencer's OWN device — never to getFirstToasterDeviceId(), which
        // would steer instance B's locks onto instance A's worklet.
        const locks = step.paramLocks;
        for (const [key, value] of Object.entries(locks)) {
            if (key.startsWith('_')) {
                continue;
            }
            setToasterPadParam(deviceId, track.padIndex, key as keyof import('../models/ToasterKit').PadState, value);
        }

        // Resolve the sound-locked engine index for this step but DON'T swap
        // the shared engine slot yet — overlapping sound-locked steps on the
        // same pad would cross-talk. The swap rides inside the deferred fire.
        const lockedEngineIdx = step.soundLock ? (TOASTER_ENGINE_MAP[step.soundLock] ?? 0) : null;
        const defaultEngineIdx = pad ? (TOASTER_ENGINE_MAP[pad.engineType] ?? 0) : null;

        const microOffsetMs = step.microTiming * stepDurationMs;
        const swingMs = stepIdx % 2 === 1 ? state.kit.swing * stepDurationMs * 0.5 : 0;
        const totalDelayMs = Math.max(0, swingMs + microOffsetMs);

        const padIndex = track.padIndex;
        const fire = () => {
            // Carry the locked engine into the fire so the swap happens right
            // before the trigger and reverts right after, per-trigger — never
            // mutating the shared slot ahead of the delay.
            if (lockedEngineIdx !== null && defaultEngineIdx !== null) {
                setPadEngineImmediate(deviceId, padIndex, lockedEngineIdx);
                triggerToasterPad(deviceId, padIndex, vel);
                setPadEngineImmediate(deviceId, padIndex, defaultEngineIdx);
            } else {
                triggerToasterPad(deviceId, padIndex, vel);
            }
        };

        if (totalDelayMs > 1) {
            scheduleTrackedFire(seqState, fire, totalDelayMs);
        } else {
            fire();
        }

        if (step.retriggerCount > 0) {
            const subInterval = stepDurationMs / (step.retriggerCount + 1);
            for (let r = 1; r <= step.retriggerCount; r++) {
                const retrigVel = Math.max(20, Math.round(vel * (1 - r * 0.12)));
                scheduleTrackedFire(
                    seqState,
                    () => triggerToasterPad(deviceId, padIndex, retrigVel),
                    totalDelayMs + subInterval * r
                );
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
    // Cancel any microtiming/retrigger fires already scheduled by the last
    // tick so no ghost hit lands after Stop.
    for (const id of seqState.pendingFireIds) {
        clearTimeout(id);
    }
    seqState.pendingFireIds.clear();
    const state = toasterStore.value?.[deviceId];
    if (state) {
        toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, isPlaying: false, currentStep: 0 } });
    }
    seqState.playCount = 0;
}
