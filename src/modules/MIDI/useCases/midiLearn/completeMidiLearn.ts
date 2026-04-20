import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { midiLearnStore, type MidiMapping, type MidiMappingTargetType } from '../../stores/midiLearnStore';

const VALUE_RANGES: Record<MidiMappingTargetType, { min: number; max: number }> = {
    trackGain: { min: 0, max: 1 },
    trackPan: { min: -50, max: 50 },
    deviceParam: { min: 0, max: 1 },
    fermenterGlobalParam: { min: 0, max: 1 },
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

            const existingIndex = state.mappings.findIndex((m) => m.channel === channel && m.cc === cc);

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
