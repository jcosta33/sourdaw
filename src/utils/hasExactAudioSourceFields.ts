import { hasValidAudioSourceState } from './audioSourceTime';
import { isRecord } from './structuralEquality';

/** A present modern source facet is never an absent legacy value. */
export function hasExactAudioSourceFields(value: unknown): boolean {
    if (!isRecord(value) || !hasValidAudioSourceState(value)) {
        return false;
    }
    return [
        'audioOffsetSeconds',
        'audioUnwrappedOffsetSeconds',
        'audioLoopStartSeconds',
        'audioLoopPassEntrySeconds',
        'audioLoopPassOriginBeat',
    ].every(
        (field) => !Object.hasOwn(value, field) || (typeof value[field] === 'number' && Number.isFinite(value[field]))
    );
}
