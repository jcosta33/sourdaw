/**
 * Sequencer playback — advances the step sequencer synchronized to AudioContext time.
 * Uses setTimeout with AudioContext clock correction to avoid setInterval drift.
 * Handles: step triggers, probability, conditional triggers, swing, ratcheting, param locks.
 */

import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { toasterStore } from '../stores/toasterStore';
import { type Step } from '../models/ToasterKit';
import { triggerToasterPad } from './triggerPad';
import { setToasterPadParam } from './toasterParamBridge';

let running = false;
let fillActive = false;
let playCount = 0;
let nextTickTime = 0; // AudioContext time of next step
let timeoutId: ReturnType<typeof setTimeout> | null = null;

export function setFillActive(active: boolean): void {
    fillActive = active;
}

function shouldTrigger(step: Step, loopIndex: number): boolean {
    if (!step.active) { return false; }

    switch (step.condition) {
        case 'fill':
            if (!fillActive) { return false; }
            break;
        case 'not-fill':
            if (fillActive) { return false; }
            break;
        case 'first':
            if (loopIndex > 0) { return false; }
            break;
        case 'not-first':
            if (loopIndex === 0) { return false; }
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
    if (!running) { return; }

    const state = toasterStore.value;
    if (!state) { return; }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) { return; }

    const totalSteps = pattern.stepsPerBar * pattern.bars;
    const stepDurationMs = (60_000 / bpm) / stepsPerBeat;

    for (const track of pattern.tracks) {
        const trackSteps = track.stepsOverride ?? totalSteps;
        const stepIdx = currentStep % trackSteps;
        const step = track.steps[stepIdx];
        if (!step) { continue; }
        if (!shouldTrigger(step, playCount)) { continue; }

        const vel = Math.round(step.velocity * 127);

        // Apply parameter locks before trigger
        const locks = step.paramLocks;
        for (const [key, value] of Object.entries(locks)) {
            if (key.startsWith('_')) { continue; }
            setToasterPadParam(track.padIndex, key as keyof import('../models/ToasterKit').PadState, value);
        }

        // Micro-timing + swing offset
        const microOffsetMs = step.microTiming * stepDurationMs;
        const swingMs = stepIdx % 2 === 1 ? state.kit.swing * stepDurationMs * 0.5 : 0;
        const totalDelayMs = Math.max(0, swingMs + microOffsetMs);

        const fire = () => triggerToasterPad(track.padIndex, vel);

        if (totalDelayMs > 1) {
            setTimeout(fire, totalDelayMs);
        } else {
            fire();
        }

        // Ratcheting
        if (step.retriggerCount > 0) {
            const subInterval = stepDurationMs / (step.retriggerCount + 1);
            for (let r = 1; r <= step.retriggerCount; r++) {
                const retrigVel = Math.max(20, Math.round(vel * (1 - r * 0.12)));
                setTimeout(() => triggerToasterPad(track.padIndex, retrigVel), totalDelayMs + subInterval * r);
            }
        }
    }

    // Update UI cursor
    toasterStore.set({ ...state, currentStep, isPlaying: true });

    // Schedule next step using AudioContext clock to prevent drift
    const stepDurationSec = stepDurationMs / 1000;
    const nextStep = (currentStep + 1) % totalSteps;
    if (nextStep === 0) { playCount++; }

    nextTickTime += stepDurationSec;
    const now = audioEngine.context.currentTime;
    const delayMs = Math.max(1, (nextTickTime - now) * 1000);

    timeoutId = setTimeout(() => tick(nextStep, bpm, stepsPerBeat), delayMs);
}

export function startSequencer(bpm: number, stepsPerBeat: number = 4): void {
    stopSequencer();
    running = true;
    playCount = 0;
    nextTickTime = audioEngine.context.currentTime;
    tick(0, bpm, stepsPerBeat);
}

export function stopSequencer(): void {
    running = false;
    if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    const state = toasterStore.value;
    if (state) {
        toasterStore.set({ ...state, isPlaying: false, currentStep: 0 });
    }
    playCount = 0;
}

export function isSequencerPlaying(): boolean {
    return running;
}
