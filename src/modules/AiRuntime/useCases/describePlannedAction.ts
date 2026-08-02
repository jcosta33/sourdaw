import { describeAction } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';

type DescribePlannedActionInput = {
    action: AppAction;
    context: ProjectContext;
};

export function describePlannedAction({ action, context }: DescribePlannedActionInput): string {
    if (action.type === 'removeTrack') {
        const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (track) {
            return `Remove track "${track.name}"`;
        }
    }
    if (action.type === 'removeClip') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (clip) {
            return `Remove clip "${clip.name}"`;
        }
    }
    if (action.type === 'quantizeNotes' || action.type === 'transposeNotes') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (clip) {
            if (action.type === 'quantizeNotes') {
                return `Quantize notes in "${clip.name}" (${clip.id}) to a ${String(action.payload.gridSize)}-beat grid`;
            }
            let signedSemitones = String(action.payload.semitones);
            if (action.payload.semitones > 0) {
                signedSemitones = `+${signedSemitones}`;
            }
            return `Transpose notes in "${clip.name}" (${clip.id}) by ${signedSemitones} semitones`;
        }
    }

    if (action.type === 'addSidechainRoute' || action.type === 'removeSidechainRoute') {
        const source = context.tracks.find((track) => track.id === action.payload.sourceTrackId);
        const target = context.tracks.find((track) => track.id === action.payload.targetTrackId);
        if (source && target) {
            const operation = action.type === 'addSidechainRoute' ? 'Add' : 'Remove';
            return `${operation} sidechain route: "${source.name}" (${source.id}) → "${target.name}" (${target.id})`;
        }
    }
    return describeAction(action);
}
