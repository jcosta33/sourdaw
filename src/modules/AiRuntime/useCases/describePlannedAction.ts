import { markerStore } from '#/modules/Arrangement/stores';
import { describeAction } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { resolveMarkerColorName } from '#/utils/markerColorPalette';

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
    if (action.type === 'normalizeClip') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        const mode = action.payload.mode ?? 'peak';
        if (mode === 'peak') {
            return `Normalize${target} using peak measurement`;
        }
        const targetDb = action.payload.targetDb ?? -14;
        if (mode === 'lufs') {
            return `Normalize${target} to ${String(targetDb)} LUFS`;
        }
        return `Normalize${target} to ${String(targetDb)} dB RMS`;
    }
    if (action.type === 'setClipStretchRatio') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        return `Set${target} stretch ratio to ${String(action.payload.ratio)}×`;
    }
    if (action.type === 'setClipStretchMode') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        return `Set${target} stretch mode to ${action.payload.mode}`;
    }
    if (action.type === 'fitClipToBeats') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        return `Fit${target} to ${String(action.payload.targetBeats)} beats`;
    }
    if (action.type === 'removeMarker') {
        const marker = markerStore.value?.markers.find((candidate) => candidate.id === action.payload.markerId);
        if (marker) {
            return `Remove marker "${marker.name}" at beat ${String(marker.beat)} (${marker.id})`;
        }
    }
    if (action.type === 'setMarkerColor') {
        const marker = markerStore.value?.markers.find((candidate) => candidate.id === action.payload.markerId);
        if (marker) {
            const color = resolveMarkerColorName(action.payload.color) ?? action.payload.color;
            return `Set marker "${marker.name}" at beat ${String(marker.beat)} (${marker.id}) color to ${color}`;
        }
    }
    if (action.type === 'addSection') {
        return `Add section "${action.payload.name}" from beat ${String(action.payload.startBeat)} to beat ${String(action.payload.endBeat)}`;
    }
    if (action.type === 'removeSection' || action.type === 'renameSection') {
        const section = markerStore.value?.sections.find((candidate) => candidate.id === action.payload.sectionId);
        if (section) {
            if (action.type === 'removeSection') {
                return `Remove section "${section.name}" from beat ${String(section.startBeat)} to beat ${String(section.endBeat)} (${section.id})`;
            }
            return `Rename section "${section.name}" to "${action.payload.name}" from beat ${String(section.startBeat)} to beat ${String(section.endBeat)} (${section.id})`;
        }
    }
    if (
        action.type === 'quantizeNotes' ||
        action.type === 'transposeNotes' ||
        action.type === 'invertNotes' ||
        action.type === 'retrogradeNotes' ||
        action.type === 'quantizeNoteLengths' ||
        action.type === 'scaleAllVelocities' ||
        action.type === 'setAllVelocities'
    ) {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (clip) {
            if (action.type === 'quantizeNotes') {
                return `Quantize notes in "${clip.name}" (${clip.id}) to a ${String(action.payload.gridSize)}-beat grid`;
            }
            if (action.type === 'transposeNotes') {
                let signedSemitones = String(action.payload.semitones);
                if (action.payload.semitones > 0) {
                    signedSemitones = `+${signedSemitones}`;
                }
                return `Transpose notes in "${clip.name}" (${clip.id}) by ${signedSemitones} semitones`;
            }
            if (action.type === 'invertNotes') {
                return `Invert notes in "${clip.name}" (${clip.id})`;
            }
            if (action.type === 'retrogradeNotes') {
                return `Retrograde notes in "${clip.name}" (${clip.id})`;
            }
            if (action.type === 'quantizeNoteLengths') {
                return `Quantize note lengths in "${clip.name}" (${clip.id}) to a ${String(action.payload.gridSize)}-beat grid`;
            }
            if (action.type === 'scaleAllVelocities') {
                return `Scale note velocities in "${clip.name}" (${clip.id}) by ×${String(action.payload.factor)}`;
            }
            return `Set note velocities in "${clip.name}" (${clip.id}) to ${String(action.payload.velocity)}`;
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
