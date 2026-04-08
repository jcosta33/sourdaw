import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import {
    midiLearnStore,
    type LearningTarget,
    type MidiMapping,
    type MidiMappingTargetType,
} from '../stores/midiLearnStore';
import { setTrackGain, setTrackPan } from '#/modules/Arrangement/useCases/setTrackGainPan';
import { setDeviceParameter } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { setFermenterParamWithAudio } from '#/modules/Fermenter/useCases/fermenterParamBridge';
import { recordAutomationValue } from '#/modules/Automation/useCases/automationRecording/recordAutomationValue';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';

let nextMappingId = 1;

const VALUE_RANGES: Record<MidiMappingTargetType, { min: number; max: number }> = {
    trackGain: { min: 0, max: 1 },
    trackPan: { min: -50, max: 50 },
    deviceParam: { min: 0, max: 1 },
    fermenterGlobalParam: { min: 0, max: 1 },
};

export function scaleMidiValue(raw: number, min: number, max: number): number {
    return min + (raw / 127) * (max - min);
}

export const startMidiLearn = inject({ logger })(
    ({ logger }) =>
        function startMidiLearn(target: LearningTarget): void {
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
);

export const stopMidiLearn = inject({ logger })(
    ({ logger }) =>
        function stopMidiLearn(): void {
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
);

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
);

export const handleMidiMessage = inject({
    setTrackGain,
    setTrackPan,
    engineSetTrackGain,
    engineSetTrackPan,
    setDeviceParameter,
    setFermenterParamWithAudio,
    getTransportState,
    recordAutomationValue,
    getAllTracks,
    getTrackStoreState,
})(
    ({
        setTrackGain,
        setTrackPan,
        engineSetTrackGain,
        engineSetTrackPan,
        setDeviceParameter,
        setFermenterParamWithAudio,
        getTransportState,
        recordAutomationValue,
        getAllTracks,
        getTrackStoreState,
    }) =>
        function handleMidiMessage(channel: number, cc: number, value: number): void {
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
                    case 'fermenterGlobalParam': {
                        if (mapping.paramId) {
                            let fermenterDeviceId: string | undefined;
                            for (const track of getAllTracks()) {
                                const d = track.devices.find((dev) => dev.type === 'fermenter');
                                if (d) {
                                    fermenterDeviceId = d.id;
                                    break;
                                }
                            }
                            if (fermenterDeviceId) {
                                setFermenterParamWithAudio(fermenterDeviceId, mapping.paramId as never, scaled);
                            }

                            const transport = getTransportState();
                            if (transport?.isPlaying) {
                                const trackState = getTrackStoreState();
                                if (trackState) {
                                    for (const track of trackState.tracks) {
                                        if (
                                            track.automationMode === 'write' ||
                                            track.automationMode === 'touch' ||
                                            track.automationMode === 'latch'
                                        ) {
                                            const fermenterDevice = track.devices.find((d) => d.type === 'fermenter');
                                            if (fermenterDevice) {
                                                recordAutomationValue(
                                                    track.id,
                                                    `${fermenterDevice.id}:${mapping.paramId}`,
                                                    scaled,
                                                    transport.playheadPosition
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }
);

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
