/**
 * Track alternatives use cases.
 * Manage multiple clip arrangements per track for A/B comparison.
 *
 * The Track model already has `alternatives: TrackAlternative[]` and
 * `activeAlternativeId: string`. These use cases swap clip data between
 * the active alternative and the archive.
 */

import { getTrackState, setTrackState } from '../repositories/trackRepository';
import { type TrackAlternative } from '../models/Track';

/**
 * Create a new alternative on a track and optionally switch to it.
 */
export function createTrackAlternative(trackId: string, name?: string, switchToIt = false): string | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return null;
    }

    const altId = `alt-${crypto.randomUUID().slice(0, 8)}`;
    const newAlt: TrackAlternative = {
        id: altId,
        name: name ?? `Alternative ${track.alternatives.length + 1}`,
        clips: switchToIt ? [] : [],
    };

    if (switchToIt) {
        // Save current clips into the current active alternative
        const updatedAlternatives = track.alternatives.map((a) =>
            a.id === track.activeAlternativeId ? { ...a, clips: [...track.clips] } : a
        );

        setTrackState({
            ...state,
            tracks: state.tracks.map((t) =>
                t.id === trackId
                    ? {
                          ...t,
                          alternatives: [...updatedAlternatives, newAlt],
                          activeAlternativeId: altId,
                          clips: [], // Start fresh
                      }
                    : t
            ),
        });
    } else {
        setTrackState({
            ...state,
            tracks: state.tracks.map((t) =>
                t.id === trackId
                    ? {
                          ...t,
                          alternatives: [...t.alternatives, { ...newAlt, clips: [...t.clips] }],
                      }
                    : t
            ),
        });
    }

    return altId;
}

/**
 * Switch to a different alternative on a track.
 * Saves current clips to the active alternative, loads target alternative's clips.
 */
export function switchTrackAlternative(trackId: string, alternativeId: string): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return false;
    }

    if (track.activeAlternativeId === alternativeId) {
        return true; // Already active
    }

    const targetAlt = track.alternatives.find((a) => a.id === alternativeId);
    if (!targetAlt) {
        return false;
    }

    // Save current clips into the current alternative
    const updatedAlternatives = track.alternatives.map((a) =>
        a.id === track.activeAlternativeId ? { ...a, clips: [...track.clips] } : a
    );

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId
                ? {
                      ...t,
                      alternatives: updatedAlternatives,
                      activeAlternativeId: alternativeId,
                      clips: [...targetAlt.clips],
                  }
                : t
        ),
    });

    return true;
}

/**
 * Delete a track alternative. Cannot delete the last one.
 */
export function deleteTrackAlternative(trackId: string, alternativeId: string): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.alternatives.length <= 1) {
        return false;
    }

    // If deleting the active one, switch to another first
    if (track.activeAlternativeId === alternativeId) {
        const remaining = track.alternatives.find((a) => a.id !== alternativeId);
        if (!remaining) {
            return false;
        }
        switchTrackAlternative(trackId, remaining.id);
        // Re-read state after switch
        const updated = getTrackState();
        if (updated) {
            setTrackState({
                ...updated,
                tracks: updated.tracks.map((t) =>
                    t.id === trackId
                        ? { ...t, alternatives: t.alternatives.filter((a) => a.id !== alternativeId) }
                        : t
                ),
            });
        }
    } else {
        setTrackState({
            ...state,
            tracks: state.tracks.map((t) =>
                t.id === trackId
                    ? { ...t, alternatives: t.alternatives.filter((a) => a.id !== alternativeId) }
                    : t
            ),
        });
    }

    return true;
}

/**
 * Rename a track alternative.
 */
export function renameTrackAlternative(trackId: string, alternativeId: string, name: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId
                ? {
                      ...t,
                      alternatives: t.alternatives.map((a) =>
                          a.id === alternativeId ? { ...a, name } : a
                      ),
                  }
                : t
        ),
    });
}

/**
 * Get all alternatives for a track.
 */
export function getTrackAlternatives(trackId: string): TrackAlternative[] {
    const state = getTrackState();
    if (!state) {
        return [];
    }
    const track = state.tracks.find((t) => t.id === trackId);
    return track?.alternatives ?? [];
}
