/**
 * Sequencer playback — advances the step sequencer synchronized to AudioContext time.
 * Uses setTimeout with AudioContext clock correction to avoid setInterval drift.
 * Handles: step triggers, probability, conditional triggers, swing, ratcheting, param locks.
 */

import { getAudioTime } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { type PadState, type Pattern } from '../models/ToasterKit';
import { toasterStore, type ToasterState } from '../stores/toasterStore';

import { getSequencerPlaybackState, type SequencerPlaybackState } from './getSequencerPlaybackState';
import { TOASTER_ENGINE_MAP } from './loadToasterKit';
import { morphPatterns } from './patternMorph';
import { projectToasterPatternGroove } from './projectToasterPatternGroove';
import { projectToasterStepEvents } from './projectToasterStepEvents';
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
    for (const track of pattern.tracks) {
        const trackSteps = track.stepsOverride ?? totalSteps;
        const stepIdx = currentStep % trackSteps;
        const step = track.steps[stepIdx];
        if (!step || !shouldTriggerSequencerStep({ deviceId, step, loopIndex })) {
            continue;
        }

        const projection = projectToasterStepEvents({
            deviceId,
            patternId: sourcePatternId,
            stepsPerBar: pattern.stepsPerBar,
            loopLengthBeats: trackSteps * stepDurationBeats,
            padIndex: track.padIndex,
            stepIndex: stepIdx,
            step,
            swing: state.kit.swing,
        });
        if (!projection.ok) {
            return false;
        }
        const gridStartBeat = stepIdx * stepDurationBeats;
        const pad = state.kit.pads[track.padIndex];
        const locks = Object.entries(step.paramLocks).filter(([key]) => !key.startsWith('_'));
        const lockedEngineIdx = step.soundLock ? TOASTER_ENGINE_MAP[step.soundLock] : null;
        const defaultEngineIdx = pad ? TOASTER_ENGINE_MAP[pad.engineType] : null;
        const padIndex = track.padIndex;

        function fireBase(velocity: number): void {
            for (const [key, value] of locks) {
                setToasterPadParam(deviceId, padIndex, key as keyof PadState, value);
            }
            if (lockedEngineIdx !== null && defaultEngineIdx !== null) {
                setPadEngineImmediate(deviceId, padIndex, lockedEngineIdx);
                triggerToasterPad(deviceId, padIndex, velocity);
                setPadEngineImmediate(deviceId, padIndex, defaultEngineIdx);
            } else {
                triggerToasterPad(deviceId, padIndex, velocity);
            }
        }

        for (const hit of projection.hits) {
            const totalDelayMs = Math.max(0, gridDelayMs + (hit.startBeat - gridStartBeat) * (60_000 / bpm));
            const fire =
                hit.retriggerIndex === 0
                    ? () => fireBase(hit.velocity)
                    : () => triggerToasterPad(deviceId, padIndex, hit.velocity);
            if (totalDelayMs > 1) {
                scheduleSequencerFire({
                    seqState,
                    fire,
                    delayMs: totalDelayMs,
                });
            } else {
                fire();
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

    const now = getAudioTime();
    const currentBpm = transportStore.value?.tempo ?? bpm;
    if (seqState.lastBpm !== null && seqState.lastBpm !== currentBpm) {
        for (const id of seqState.pendingFireIds) {
            clearTimeout(id);
        }
        seqState.pendingFireIds.clear();
        seqState.preScheduledStep = null;
        seqState.nextTickTime = now;
    }
    seqState.lastBpm = currentBpm;

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
    const stepDurationMs = (60_000 / currentBpm) * stepDurationBeats;
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
            bpm: currentBpm,
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
            bpm: currentBpm,
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
    const delayMs = Math.max(1, (seqState.nextTickTime - now) * 1000);

    seqState.timeoutId = setTimeout(
        () => runSequencerTick({ deviceId, currentStep: nextStep, bpm: currentBpm }),
        delayMs
    );
}
