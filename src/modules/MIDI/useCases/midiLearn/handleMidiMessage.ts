import { midiLearnStore } from '../../stores/midiLearnStore';

import { getMidiLearnDependencies } from './midiLearnDependencies';

export function scaleMidiValue(raw: number, min: number, max: number): number {
    return min + (raw / 127) * (max - min);
}

export function handleMidiMessage(channel: number, cc: number, value: number): void {
    const state = midiLearnStore.value;
    if (!state) {
        return;
    }

    const matchingMappings = state.mappings.filter((m) => m.channel === channel && m.cc === cc);
    if (matchingMappings.length === 0) {
        return;
    }

    const deps = getMidiLearnDependencies();

    for (const mapping of matchingMappings) {
        const scaled = scaleMidiValue(value, mapping.minValue, mapping.maxValue);

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
                        const d = track.devices.find((dev) => dev.type === 'fermenter');
                        if (d) {
                            fermenterDeviceId = d.id;
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
                                const fermenterDevice = track.devices.find((d) => d.type === 'fermenter');
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
