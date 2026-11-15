import { type AppAction } from '#/utils/handlerContract';

export function describeDrumPreviewBranches(action: Extract<AppAction, { type: 'createDrumPreviewBranches' }>): string {
    const candidates = action.payload.candidates
        .map(
            (candidate) =>
                `"${candidate.branchName}" (${candidate.branchId}, ${candidate.rootDocId}, ${candidate.recipe})`
        )
        .join(', ');
    return `Create exactly three preview branches for "${action.payload.sectionName}" (${action.payload.sectionId}, beats ${String(action.payload.sectionStartBeat)}–${String(action.payload.sectionEndBeat)}): ${candidates}; preserve Kick track "${action.payload.kick.trackName}" (${action.payload.kick.trackId}) clip "${action.payload.kick.clipName}" (${action.payload.kick.clipId}) exactly; vary only Snare clip "${action.payload.snare.clipName}" (${action.payload.snare.clipId}) and Hi-Hat clip "${action.payload.hiHat.clipName}" (${action.payload.hiHat.clipId}); keep the source branch active and unchanged`;
}
