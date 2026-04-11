import { midiLearnStore, type LearningTarget, type MidiMapping } from '../../stores/midiLearnStore';

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