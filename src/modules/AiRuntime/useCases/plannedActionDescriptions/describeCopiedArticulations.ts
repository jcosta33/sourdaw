import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { getMidiArticulationSemanticChanges } from '../../transformers/getMidiArticulationSemanticChanges';

/** The articulation copy in words, or `null` when its clips or changes are not readable. */
export function describeCopiedArticulations(
    action: Extract<AppAction, { type: 'copyMidiArticulations' }>,
    context: ProjectContext
): string | null {
    const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
    const source = track?.clips.find((clip) => clip.id === action.payload.sourceClipId);
    const target = track?.clips.find((clip) => clip.id === action.payload.targetClipId);
    const changes = getMidiArticulationSemanticChanges({
        notePairs: action.payload.notePairs,
        sourceNotes: action.payload.expectedSourceNotes,
        targetNotes: action.payload.expectedTargetNotes,
    });
    if (!track || !source || !target || !changes || changes.length === 0) {
        return null;
    }
    const noteChanges = changes
        .map((change) => {
            const current = change.currentTargetArticulation ?? 'none';
            const sourceValue = change.sourceArticulation ?? 'none';
            return `target note ${change.targetNoteId} from ${change.sourceNoteId} articulation ${current} → ${sourceValue}`;
        })
        .join('; ');
    return `Track "${track.name}" (${track.id}): "${source.name}" (${source.id}) → "${target.name}" (${target.id}); ${noteChanges}; preserve target pitches, velocities, timing, and expression`;
}
