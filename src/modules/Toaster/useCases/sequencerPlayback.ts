/**
 * Sequencer playback — advances the step sequencer synchronized to AudioContext time.
 * Uses setTimeout with AudioContext clock correction to avoid setInterval drift.
 * Handles: step triggers, probability, conditional triggers, swing, ratcheting, param locks.
 */

import { getAudioTime } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { type Pattern } from '../models/ToasterKit';
import { toasterStore, type ToasterState } from '../stores/toasterStore';

import { cancelScheduledToasterHits } from './cancelScheduledToasterHits';
import { getSequencerPlaybackState } from './getSequencerPlaybackState';
import { morphPatterns } from './patternMorph';
import { projectToasterPatternGroove } from './projectToasterPatternGroove';
import { projectToasterStepEvents } from './projectToasterStepEvents';
import { scheduleToasterHit } from './scheduleToasterHit';
import { shouldTriggerSequencerStep } from './shouldTriggerSequencerStep';
import { stopSequencer } from './stopSequencer';
import { TOASTER_ENGINE_MAP } from './toasterEngineMap';

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
    currentStep: number;
    bpm: number;
    loopIndex: number;
    gridDelayMs: number;
    audioTimeSeconds: number;
};

function schedulePatternStep({
    deviceId,
    sourcePatternId,
    pattern,
    state,
    currentStep,
    bpm,
    loopIndex,
    gridDelayMs,
    audioTimeSeconds,
}: SchedulePatternStepInput): boolean {
    const totalSteps = pattern.stepsPerBar * pattern.bars;
    const stepDurationBeats = 4 / pattern.stepsPerBar;
    for (const track of pattern.tracks) {
        const trackSteps = track.stepsOverride ?? totalSteps;
        const stepIdx = currentStep % trackSteps;
        const step = track.steps[stepIdx];
        if (!step || !shouldTriggerSequencerStep({ deviceId, step, loopIndex, deferFillCondition: true })) {
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
        const padParams = Object.entries(step.paramLocks)
            .filter(([key]) => !key.startsWith('_'))
            .map(([name, value]) => ({ name, value }));
        let lockedEngineIdx: number | null = null;
        if (step.soundLock) {
            lockedEngineIdx = TOASTER_ENGINE_MAP[step.soundLock];
        }
        let defaultEngineIdx: number | null = null;
        if (pad) {
            defaultEngineIdx = TOASTER_ENGINE_MAP[pad.engineType];
        }
        const padIndex = track.padIndex;

        for (const hit of projection.hits) {
            const projectedStartBeat = hit.startBeat + hit.loopOffsetBeats;
            const totalDelayMs = Math.max(0, gridDelayMs + (projectedStartBeat - gridStartBeat) * (60_000 / bpm));
            let scheduledPadParams: Array<{ name: string; value: number }> = [];
            let restoreEngineType: number | undefined;
            if (hit.retriggerIndex === 0) {
                scheduledPadParams = padParams;
                if (lockedEngineIdx !== null && defaultEngineIdx !== null) {
                    scheduledPadParams = [...padParams, { name: 'engineType', value: lockedEngineIdx }];
                    restoreEngineType = defaultEngineIdx;
                }
            }
            scheduleToasterHit({
                deviceId,
                padIndex,
                velocity: hit.velocity,
                targetTimeSeconds: audioTimeSeconds + totalDelayMs / 1000,
                padParams: scheduledPadParams,
                restoreEngineType,
                fillCondition: step.condition === 'fill' || step.condition === 'not-fill' ? step.condition : undefined,
            });
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
    if (!Number.isFinite(currentBpm) || currentBpm <= 0) {
        stopSequencer(deviceId);
        return;
    }
    if (seqState.lastBpm !== null && seqState.lastBpm !== currentBpm) {
        cancelScheduledToasterHits(deviceId);
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
        stopSequencer(deviceId);
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
        stopSequencer(deviceId);
        return;
    }

    if (seqState.preScheduledStep === currentStep) {
        seqState.preScheduledStep = null;
    } else {
        const scheduled = schedulePatternStep({
            deviceId,
            sourcePatternId: sourcePattern.id,
            pattern,
            state,
            currentStep,
            bpm: currentBpm,
            loopIndex: seqState.playCount,
            gridDelayMs: 0,
            audioTimeSeconds: now,
        });
        if (!scheduled) {
            stopSequencer(deviceId);
            return;
        }
    }

    toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, currentStep, isPlaying: true } });

    let nextStep = currentStep;
    let nextTickTime = seqState.nextTickTime;
    do {
        nextStep = (nextStep + 1) % totalSteps;
        if (nextStep === 0) {
            seqState.playCount++;
        }
        nextTickTime += stepDurationMs / 1000;
    } while (nextTickTime <= now);

    const scheduledNextStep = schedulePatternStep({
        deviceId,
        sourcePatternId: sourcePattern.id,
        pattern,
        state,
        currentStep: nextStep,
        bpm: currentBpm,
        loopIndex: seqState.playCount,
        gridDelayMs: (nextTickTime - now) * 1000,
        audioTimeSeconds: now,
    });
    if (!scheduledNextStep) {
        stopSequencer(deviceId);
        return;
    }
    seqState.preScheduledStep = nextStep;

    seqState.nextTickTime = nextTickTime;
    const delayMs = Math.max(1, (nextTickTime - now) * 1000);

    seqState.timeoutId = setTimeout(
        () => runSequencerTick({ deviceId, currentStep: nextStep, bpm: currentBpm }),
        delayMs
    );
}
