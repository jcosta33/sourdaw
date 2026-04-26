import { midiLearnStore, type LearningTarget, type MidiMapping } from '../../stores/midiLearnStore';

export function findMappingForTarget(target: LearningTarget): MidiMapping | undefined {
    const state = midiLearnStore.value;
    if (!state) {
        return undefined;
    }

    return state.mappings.find(
        (message) =>
            message.targetType === target.targetType &&
            message.trackId === target.trackId &&
            message.deviceId === target.deviceId &&
            message.paramId === target.paramId
    );
}
