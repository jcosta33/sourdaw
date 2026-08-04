import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

type PopulateGeneratedMidiStateGuardInput = {
    guard: GeneratedMidiStateGuard;
    entity: object;
    clipIds: readonly string[];
};

export function populateGeneratedMidiStateGuard({
    guard,
    entity,
    clipIds,
}: PopulateGeneratedMidiStateGuardInput): void {
    guard.entityJson = JSON.stringify(entity);
    guard.midiByClipIdJson = serializeMidiStateForClips(clipIds);
}
