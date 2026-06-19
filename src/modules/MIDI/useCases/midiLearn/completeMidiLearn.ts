import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import {
    midiLearnStore,
    type MidiMapping,
    type MidiMappingScaleMode,
    type MidiMappingTargetType,
} from '../../stores/midiLearnStore';

/**
 * Per-target value contract for MIDI Learn. Ranges mirror the real param
 * contracts each target writes to:
 *  - `trackGain`  → `setTrackGain` clamps [0, 1] (linear amplitude), but a
 *    knob/fader feels right with a perceptual `log` taper, so that is the default.
 *  - `trackPan`   → `setTrackPan` clamps [-50, 50] (linear, symmetric).
 *  - `deviceParam` / `fermenterGlobalParam` → normalised [0, 1], linear.
 */
const VALUE_RANGES: Record<MidiMappingTargetType, { min: number; max: number; scaleMode: MidiMappingScaleMode }> = {
    trackGain: { min: 0, max: 1, scaleMode: 'log' },
    trackPan: { min: -50, max: 50, scaleMode: 'linear' },
    deviceParam: { min: 0, max: 1, scaleMode: 'linear' },
    fermenterGlobalParam: { min: 0, max: 1, scaleMode: 'linear' },
};

export const completeMidiLearn = inject({ logger })(
    ({ logger }) =>
        function completeMidiLearn(channel: number, cc: number): void {
            const state = midiLearnStore.value;
            if (!state || !state.isLearning || !state.learningTarget) {
                return;
            }

            const target = state.learningTarget;
            const defaults = VALUE_RANGES[target.targetType];

            const existingIndex = state.mappings.findIndex(
                (message) => message.channel === channel && message.cc === cc
            );

            const mapping: MidiMapping = {
                id: `midi-map-${crypto.randomUUID()}`,
                channel,
                cc,
                targetType: target.targetType,
                trackId: target.trackId,
                deviceId: target.deviceId,
                paramId: target.paramId,
                minValue: defaults.min,
                maxValue: defaults.max,
                scaleMode: defaults.scaleMode,
            };

            const mappings = [...state.mappings];
            if (existingIndex >= 0) {
                mappings[existingIndex] = mapping;
            } else {
                mappings.push(mapping);
            }

            logger.info(`MIDI Learn complete: CC ${cc} ch ${channel} → ${target.targetType}`);

            midiLearnStore.set({
                ...state,
                mappings,
                isLearning: false,
                learningTarget: null,
            });
        }
);
