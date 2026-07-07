/**
 * Sequencer playback — advances the step sequencer synchronized to AudioContext time.
 * Uses setTimeout with AudioContext clock correction to avoid setInterval drift.
 * Handles: step triggers, probability, conditional triggers, swing, ratcheting, param locks.
 */

import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { type PadState, type Pattern } from '../models/ToasterKit';
import { toasterStore } from '../stores/toasterStore';

import { getSequencerPlaybackState } from './getSequencerPlaybackState';
import { TOASTER_ENGINE_MAP } from './loadToasterKit';
import { morphPatterns } from './patternMorph';
import { scheduleSequencerFire } from './scheduleSequencerFire';
import { shouldTriggerSequencerStep } from './shouldTriggerSequencerStep';
import { setPadEngineImmediate } from './toasterParamBridge/setPadEngineImmediate';
import { setToasterPadParam } from './toasterParamBridge/setToasterPadParam';
import { triggerToasterPad } from './triggerPad';

type RunSequencerTickInput = {
    deviceId: string;
    currentStep: number;
    bpm: number;
    stepsPerBeat: number;
};

export function runSequencerTick({ deviceId, currentStep, bpm, stepsPerBeat }: RunSequencerTickInput): void {
    const seqState = getSequencerPlaybackState(deviceId);
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
        if (!shouldTriggerSequencerStep({ deviceId, step, loopIndex: seqState.playCount })) {
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
            setToasterPadParam(deviceId, track.padIndex, key as keyof PadState, value);
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
        function fire(): void {
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
        }

        if (totalDelayMs > 1) {
            scheduleSequencerFire({ seqState, fire, delayMs: totalDelayMs });
        } else {
            fire();
        }

        if (step.retriggerCount > 0) {
            const subInterval = stepDurationMs / (step.retriggerCount + 1);
            for (let r = 1; r <= step.retriggerCount; r++) {
                const retrigVel = Math.max(20, Math.round(vel * (1 - r * 0.12)));
                scheduleSequencerFire({
                    seqState,
                    fire: () => triggerToasterPad(deviceId, padIndex, retrigVel),
                    delayMs: totalDelayMs + subInterval * r,
                });
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

    seqState.timeoutId = setTimeout(
        () => runSequencerTick({ deviceId, currentStep: nextStep, bpm, stepsPerBeat }),
        delayMs
    );
}
