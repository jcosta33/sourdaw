/**
 * Sequencer playback — advances the step sequencer synchronized to AudioContext time.
 * Uses setTimeout with AudioContext clock correction to avoid setInterval drift.
 * Handles: step triggers, probability, conditional triggers, swing, ratcheting, param locks.
 */

import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { type PadState, type Pattern } from '../models/ToasterKit';
import { toasterStore, type ToasterState } from '../stores/toasterStore';

import { getSequencerPlaybackState, type SequencerPlaybackState } from './getSequencerPlaybackState';
import { TOASTER_ENGINE_MAP } from './loadToasterKit';
import { morphPatterns } from './patternMorph';
import { projectToasterPatternGroove } from './projectToasterPatternGroove';
import { scheduleSequencerFire } from './scheduleSequencerFire';
import { shouldTriggerSequencerStep } from './shouldTriggerSequencerStep';
import { setPadEngineImmediate } from './toasterParamBridge/setPadEngineImmediate';
import { setToasterPadParam } from './toasterParamBridge/setToasterPadParam';
import { triggerToasterPad } from './triggerPad';

type RunSequencerTickInput = {
    deviceId: string;
    currentStep: number;
    bpm: number;
};

type SchedulePatternStepInput = {
    deviceId: string;
    sourcePatternId: string;
    pattern: Pattern;
    state: ToasterState;
    seqState: SequencerPlaybackState;
    currentStep: number;
    bpm: number;
    loopIndex: number;
    gridDelayMs: number;
};

function schedulePatternStep({
    deviceId,
    sourcePatternId,
    pattern,
    state,
    seqState,
    currentStep,
    bpm,
    loopIndex,
    gridDelayMs,
}: SchedulePatternStepInput): boolean {
    const totalSteps = pattern.stepsPerBar * pattern.bars;
    const stepDurationBeats = 4 / pattern.stepsPerBar;
    const stepDurationMs = (60_000 / bpm) * stepDurationBeats;

    for (const track of pattern.tracks) {
        const trackSteps = track.stepsOverride ?? totalSteps;
        const stepIdx = currentStep % trackSteps;
        const step = track.steps[stepIdx];
        if (!step || !shouldTriggerSequencerStep({ deviceId, step, loopIndex })) {
            continue;
        }

        const gridStartBeat = stepIdx * stepDurationBeats;
        const microOffsetBeats = step.microTiming * stepDurationBeats;
        const swingBeats = stepIdx % 2 === 1 ? state.kit.swing * stepDurationBeats * 0.5 : 0;
        const sourceEvent = {
            id: `${track.padIndex}:${stepIdx}`,
            startBeat: Math.max(0, gridStartBeat + microOffsetBeats + swingBeats),
            velocity: Math.round(step.velocity * 127),
        };
        const grooveProjection = projectToasterPatternGroove({
            deviceId,
            patternId: sourcePatternId,
            stepsPerBar: pattern.stepsPerBar,
            events: [sourceEvent],
        });
        if (!grooveProjection.ok) {
            return false;
        }
        const projectedEvent = grooveProjection.events[0] ?? sourceEvent;
        const vel = projectedEvent.velocity;
        const pad = state.kit.pads[track.padIndex];
        const locks = Object.entries(step.paramLocks).filter(([key]) => !key.startsWith('_'));
        const lockedEngineIdx = step.soundLock ? TOASTER_ENGINE_MAP[step.soundLock] : null;
        const defaultEngineIdx = pad ? TOASTER_ENGINE_MAP[pad.engineType] : null;
        const grooveDelayMs = (projectedEvent.startBeat - gridStartBeat) * (60_000 / bpm);
        const totalDelayMs = Math.max(0, gridDelayMs + grooveDelayMs);
        const padIndex = track.padIndex;

        function fire(): void {
            for (const [key, value] of locks) {
                setToasterPadParam(deviceId, padIndex, key as keyof PadState, value);
            }
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
            for (let retrigger = 1; retrigger <= step.retriggerCount; retrigger++) {
                const retrigVel = Math.max(20, Math.round(vel * (1 - retrigger * 0.12)));
                scheduleSequencerFire({
                    seqState,
                    fire: () => triggerToasterPad(deviceId, padIndex, retrigVel),
                    delayMs: totalDelayMs + subInterval * retrigger,
                });
            }
        }
    }
    return true;
}

export function runSequencerTick({ deviceId, currentStep, bpm }: RunSequencerTickInput): void {
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

    if (!Number.isFinite(pattern.stepsPerBar) || pattern.stepsPerBar <= 0) {
        return;
    }
    const totalSteps = pattern.stepsPerBar * pattern.bars;
    const stepDurationBeats = 4 / pattern.stepsPerBar;
    const stepDurationMs = (60_000 / bpm) * stepDurationBeats;
    const grooveCapability = projectToasterPatternGroove({
        deviceId,
        patternId: sourcePattern.id,
        stepsPerBar: pattern.stepsPerBar,
        events: [],
    });
    if (!grooveCapability.ok) {
        seqState.running = false;
        toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, isPlaying: false } });
        return;
    }

    if (seqState.preScheduledStep === currentStep) {
        seqState.preScheduledStep = null;
    } else if (
        !schedulePatternStep({
            deviceId,
            sourcePatternId: sourcePattern.id,
            pattern,
            state,
            seqState,
            currentStep,
            bpm,
            loopIndex: seqState.playCount,
            gridDelayMs: 0,
        })
    ) {
        seqState.running = false;
        toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, isPlaying: false } });
        return;
    }

    toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, currentStep, isPlaying: true } });

    const stepDurationSec = stepDurationMs / 1000;
    const nextStep = (currentStep + 1) % totalSteps;
    if (nextStep === 0) {
        seqState.playCount++;
    }

    if (
        !schedulePatternStep({
            deviceId,
            sourcePatternId: sourcePattern.id,
            pattern,
            state,
            seqState,
            currentStep: nextStep,
            bpm,
            loopIndex: seqState.playCount,
            gridDelayMs: stepDurationMs,
        })
    ) {
        seqState.running = false;
        toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, isPlaying: false } });
        return;
    }
    seqState.preScheduledStep = nextStep;

    seqState.nextTickTime += stepDurationSec;
    const now = getAudioTime();
    const delayMs = Math.max(1, (seqState.nextTickTime - now) * 1000);

    seqState.timeoutId = setTimeout(() => runSequencerTick({ deviceId, currentStep: nextStep, bpm }), delayMs);
}
