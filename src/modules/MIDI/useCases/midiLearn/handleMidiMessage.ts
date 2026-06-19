import { midiLearnStore, type MidiMappingScaleMode } from '../../stores/midiLearnStore';

import { getMidiLearnDependencies } from './midiLearnDependencies';

/**
 * Map a raw 7-bit MIDI value (0–127) into [min, max] using the given curve.
 * `linear` is the default and matches the historical behaviour; `log` produces
 * a perceptual taper for gain (more travel near the top) and `exp` its inverse.
 * The normalised position is clamped to [0, 1] so out-of-spec raw values can't
 * push the result outside the target range.
 */
export function scaleMidiValue(
    raw: number,
    min: number,
    max: number,
    scaleMode: MidiMappingScaleMode = 'linear'
): number {
    const t = Math.max(0, Math.min(1, raw / 127));
    let curved: number;
    switch (scaleMode) {
        case 'log':
            // Concave curve: equal MIDI steps cover more range up high.
            curved = Math.sqrt(t);
            break;
        case 'exp':
            // Convex curve: equal MIDI steps cover more range down low.
            curved = t * t;
            break;
        case 'linear':
        default:
            curved = t;
            break;
    }
    return min + curved * (max - min);
}

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
