import { midiLearnStore } from '../../stores/midiLearnStore';

import { getMidiLearnDependencies } from './getMidiLearnDependencies';
import { scaleMidiValue } from './scaleMidiValue';

import type { Track } from '#/modules/Arrangement/stores';

/**
 * Apply one incoming controller value to every mapping learned for it.
 *
 * `normalized` is the caller's already-resolved 0..1 position. It is optional
 * and defaults to `value / 127`; the Web MIDI input path supplies it so a
 * controller that arrived as a 14-bit MSB/LSB pair drives its mapped target at
 * full resolution rather than the 128 steps its MSB alone carries (audit MD-7).
 */
export function handleMidiMessage(channel: number, cc: number, value: number, normalized?: number): void {
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
        const scaled = scaleMidiValue(value, mapping.minValue, mapping.maxValue, mapping.scaleMode, normalized);

        switch (mapping.targetType) {
            case 'trackGain': {
                if (mapping.trackId) {
                    // Both writes take the same resolved value. The store-side
                    // call clamps on its own; the engine-side call does not, and
                    // it lands second, so passing the raw scaled value there put
                    // the audio node above the ceiling the project had just
                    // recorded.
                    const gain = deps.clampTrackGain(scaled);
                    deps.setTrackGainArrangement(mapping.trackId, gain);
                    deps.engineSetTrackGain(mapping.trackId, gain);
                }
                break;
            }
            case 'trackPan': {
                if (mapping.trackId) {
                    deps.setTrackPanArrangement(mapping.trackId, scaled);
                    deps.engineSetTrackPan(mapping.trackId, scaled);
                }
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
                    // Find the single track/device pair `setFermenterMappedParam`
                    // below will actually target. Recording automation for a
                    // different armed track would write a value into its lane
                    // that its live parameter never moved to (F-1).
                    let targetTrack: Track | undefined;
                    let fermenterDeviceId: string | undefined;
                    for (const track of deps.getAllTracks()) {
                        const fermenter = track.devices.find((device) => device.type === 'fermenter');
                        if (fermenter) {
                            targetTrack = track;
                            fermenterDeviceId = fermenter.id;
                            break;
                        }
                    }

                    if (targetTrack && fermenterDeviceId) {
                        deps.setFermenterMappedParam({
                            deviceId: fermenterDeviceId,
                            paramId: mapping.paramId,
                            value: scaled,
                        });

                        const isArmedToRecord =
                            targetTrack.automationMode === 'write' ||
                            targetTrack.automationMode === 'touch' ||
                            targetTrack.automationMode === 'latch';

                        if (deps.getTransportIsPlaying() && isArmedToRecord) {
                            deps.recordAutomationValue(
                                targetTrack.id,
                                `${fermenterDeviceId}:${mapping.paramId}`,
                                scaled,
                                deps.getTransportPlayheadPosition()
                            );
                        }
                    }
                }
                break;
            }
        }
    }
}
