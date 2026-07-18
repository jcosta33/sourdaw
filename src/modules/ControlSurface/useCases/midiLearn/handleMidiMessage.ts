import { midiLearnStore } from '../../stores/midiLearnStore';

import { getMidiLearnDependencies } from './getMidiLearnDependencies';
import { scaleMidiValue } from './scaleMidiValue';

export function handleMidiMessage(channel: number, cc: number, value: number): void {
    const state = midiLearnStore.value;
    if (!state) {
        return;
    }

    const matchingMappings = state.mappings.filter((mapping) => mapping.channel === channel && mapping.cc === cc);
    if (matchingMappings.length === 0) {
        return;
    }

    const deps = getMidiLearnDependencies();

    for (const mapping of matchingMappings) {
        const scaled = scaleMidiValue(value, mapping.minValue, mapping.maxValue, mapping.scaleMode);

        switch (mapping.targetType) {
            case 'trackGain': {
                deps.setTrackGainArrangement(mapping.trackId, scaled);
                deps.engineSetTrackGain(mapping.trackId, scaled);
                break;
            }
            case 'trackPan': {
                deps.setTrackPanArrangement(mapping.trackId, scaled);
                deps.engineSetTrackPan(mapping.trackId, scaled);
                break;
            }
            case 'deviceParam': {
                if (mapping.deviceId && mapping.paramId) {
                    deps.setDeviceParameter(mapping.deviceId, mapping.paramId, scaled);
                }
                break;
            }
            case 'fermenterGlobalParam': {
                if (mapping.paramId) {
                    let fermenterDeviceId: string | undefined;
                    for (const track of deps.getAllTracks()) {
                        const fermenter = track.devices.find((device) => device.type === 'fermenter');
                        if (fermenter) {
                            fermenterDeviceId = fermenter.id;
                            break;
                        }
                    }
                    if (fermenterDeviceId) {
                        deps.setFermenterMappedParam({
                            deviceId: fermenterDeviceId,
                            paramId: mapping.paramId,
                            value: scaled,
                        });
                    }

                    if (deps.getTransportIsPlaying()) {
                        for (const track of deps.getAllTracks()) {
                            if (
                                track.automationMode === 'write' ||
                                track.automationMode === 'touch' ||
                                track.automationMode === 'latch'
                            ) {
                                const fermenterDevice = track.devices.find((device) => device.type === 'fermenter');
                                if (fermenterDevice) {
                                    deps.recordAutomationValue(
                                        track.id,
                                        `${fermenterDevice.id}:${mapping.paramId}`,
                                        scaled,
                                        deps.getTransportPlayheadPosition()
                                    );
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
