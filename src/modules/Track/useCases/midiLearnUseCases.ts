import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import {
    midiLearnStore,
    type LearningTarget,
    type MidiMapping,
    type MidiMappingTargetType,
} from '../stores/midiLearnStore';
import { setTrackGain, setTrackPan } from './setTrackGainPan';
import { setDeviceParameter } from './deviceUseCases';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';

const logger = Container.getInstance().get(Logger);

let nextMappingId = 1;

const VALUE_RANGES: Record<MidiMappingTargetType, { min: number; max: number }> = {
    trackGain: { min: 0, max: 1 },
    trackPan: { min: -50, max: 50 },
    deviceParam: { min: 0, max: 1 },
};

function scaleMidiValue(raw: number, min: number, max: number): number {
    return min + (raw / 127) * (max - min);
}

export function startMidiLearn(target: LearningTarget): void {
    const state = midiLearnStore.value;
    if (!state) {
        return;
    }

    logger.info(`MIDI Learn started for ${target.targetType} on track ${target.trackId}`);

    midiLearnStore.set({
        ...state,
        isLearning: true,
        learningTarget: target,
    });
}

export function stopMidiLearn(): void {
    const state = midiLearnStore.value;
    if (!state) {
        return;
    }

    logger.info('MIDI Learn cancelled');

    midiLearnStore.set({
        ...state,
        isLearning: false,
        learningTarget: null,
    });
}

export function completeMidiLearn(channel: number, cc: number): void {
    const state = midiLearnStore.value;
    if (!state || !state.isLearning || !state.learningTarget) {
        return;
    }

    const target = state.learningTarget;
    const defaults = VALUE_RANGES[target.targetType];

    const existingIndex = state.mappings.findIndex((m) => m.channel === channel && m.cc === cc);

    const mapping: MidiMapping = {
        id: `midi-map-${nextMappingId++}`,
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

export function removeMidiMapping(mappingId: string): void {
    const state = midiLearnStore.value;
    if (!state) {
        return;
    }

    midiLearnStore.set({
        ...state,
        mappings: state.mappings.filter((m) => m.id !== mappingId),
    });
}

export function handleMidiMessage(channel: number, cc: number, value: number): void {
    const state = midiLearnStore.value;
    if (!state) {
        return;
    }

    const matchingMappings = state.mappings.filter((m) => m.channel === channel && m.cc === cc);

    for (const mapping of matchingMappings) {
        const scaled = scaleMidiValue(value, mapping.minValue, mapping.maxValue);

        switch (mapping.targetType) {
            case 'trackGain': {
                setTrackGain(mapping.trackId, scaled);
                engineSetTrackGain(mapping.trackId, scaled);
                break;
            }
            case 'trackPan': {
                setTrackPan(mapping.trackId, scaled);
                engineSetTrackPan(mapping.trackId, scaled);
                break;
            }
            case 'deviceParam': {
                if (mapping.deviceId && mapping.paramId) {
                    setDeviceParameter(mapping.deviceId, mapping.paramId, scaled);
                }
                break;
            }
        }
    }
}

export function findMappingForTarget(target: LearningTarget): MidiMapping | undefined {
    const state = midiLearnStore.value;
    if (!state) {
        return undefined;
    }

    return state.mappings.find(
        (m) =>
            m.targetType === target.targetType &&
            m.trackId === target.trackId &&
            m.deviceId === target.deviceId &&
            m.paramId === target.paramId
    );
}
