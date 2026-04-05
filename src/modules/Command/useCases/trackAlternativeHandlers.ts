import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { setTrackStoreState } from '#/modules/Arrangement/useCases/setTrackStoreState';
import { type AppAction } from '../models/AppAction';
// Types inferred from the store state returned by getTrackStoreState — no cross-module model import (AGENTS.md §95).
type TrackState = NonNullable<ReturnType<typeof getTrackStoreState>>;
type Track = TrackState['tracks'][number];
type Clip = Track['clips'][number];
type TrackAlternative = Track['alternatives'][number];

export function handleCreateTrackAlternative(action: Extract<AppAction, { type: 'createTrackAlternative' }>): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const { trackId, name, duplicateActive } = action.payload;

    setTrackStoreState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }

            const newAltId = `alt-${crypto.randomUUID()}`;

            // Deep clone active clips if duplicating, else empty
            const newClips: Clip[] = duplicateActive
                ? track.clips.map((c) => ({ ...c, id: `clip-${crypto.randomUUID()}` })) // need novel IDs
                : [];

            const newAlternative: TrackAlternative = {
                id: newAltId,
                name,
                clips: newClips,
            };

            // Before switching, save current active clips to current active alternative in the array
            const updatedAlternatives = track.alternatives.map((alt) =>
                alt.id === track.activeAlternativeId ? { ...alt, clips: [...track.clips] } : alt
            );

            // Add the new one
            updatedAlternatives.push(newAlternative);

            return {
                ...track,
                alternatives: updatedAlternatives,
                activeAlternativeId: newAltId,
                clips: newClips,
            };
        }),
    });
}

export function handleSwitchTrackAlternative(action: Extract<AppAction, { type: 'switchTrackAlternative' }>): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const { trackId, alternativeId } = action.payload;

    setTrackStoreState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }
            if (track.activeAlternativeId === alternativeId) {
                return track;
            } // Already active

            const targetAlt = track.alternatives.find((a) => a.id === alternativeId);
            if (!targetAlt) {
                return track;
            } // Doesn't exist

            // Save the currently active clips into the outgoing alternative array slot
            const updatedAlternatives = track.alternatives.map((alt) => {
                if (alt.id === track.activeAlternativeId) {
                    return { ...alt, clips: [...track.clips] };
                }
                return alt;
            });

            // Hot-swap the clips and active ID
            return {
                ...track,
                alternatives: updatedAlternatives,
                activeAlternativeId: alternativeId,
                clips: [...targetAlt.clips],
            };
        }),
    });
}

export function handleRenameTrackAlternative(action: Extract<AppAction, { type: 'renameTrackAlternative' }>): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const { trackId, alternativeId, name } = action.payload;

    setTrackStoreState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }

            return {
                ...track,
                alternatives: track.alternatives.map((alt) =>
                    alt.id === alternativeId ? { ...alt, name } : alt
                ),
            };
        }),
    });
}

export function handleDeleteTrackAlternative(action: Extract<AppAction, { type: 'deleteTrackAlternative' }>): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const { trackId, alternativeId } = action.payload;

    setTrackStoreState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }
            if (track.alternatives.length <= 1) {
                return track;
            } // Must keep at least one

            const filteredAlts = track.alternatives.filter((alt) => alt.id !== alternativeId);

            // If we deleted the active one, fallback to the first available
            if (track.activeAlternativeId === alternativeId) {
                const fallbackAlt = filteredAlts[0]!;
                return {
                    ...track,
                    alternatives: filteredAlts,
                    activeAlternativeId: fallbackAlt.id,
                    clips: [...fallbackAlt.clips], // Load the fallback clips
                };
            }

            return {
                ...track,
                alternatives: filteredAlts,
            };
        }),
    });
}
