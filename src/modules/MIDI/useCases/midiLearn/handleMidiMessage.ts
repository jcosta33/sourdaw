import { midiLearnStore } from '../../stores/midiLearnStore';

import {
    setTrackGain as setTrackGainArrangement,
    setTrackPan as setTrackPanArrangement,
    setDeviceParameter,
    getTrackStoreState,
    getAllTracks,
} from '#/modules/Arrangement/useCases';

import { setTrackGain as engineSetTrackGain, setTrackPan as engineSetTrackPan } from '#/modules/AudioEngine/useCases';
import { setFermenterMappedParam } from '#/modules/Fermenter/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

export function scaleMidiValue(raw: number, min: number, max: number): number {
    return min + (raw / 127) * (max - min);
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
                setTrackGainArrangement(mapping.trackId, scaled);
                engineSetTrackGain(mapping.trackId, scaled);
                break;
            }
            case 'trackPan': {
                setTrackPanArrangement(mapping.trackId, scaled);
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
                        setFermenterMappedParam({
                            deviceId: fermenterDeviceId,
                            paramId: mapping.paramId,
                            value: scaled,
                        });
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