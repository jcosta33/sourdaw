import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';

import { type Clip, type Track, type TrackAlternative } from '../models/Track';
import { resolveEligibleClipWriteTarget } from '../stores/resolveEligibleClipWriteTarget';
import { type TrackStoreState, trackStore } from '../stores/trackStore';

export type RelinkClipAudioSourceInput = {
    /** The missing buffer id every relinked clip currently points at — the id
     * a clip's audio is cached under (`audioBufferId`, or the clip id itself
     * for clips that predate explicit buffer bookkeeping). */
    sourceBufferId: string;
    replacementBufferId: string;
};

export type RelinkClipAudioSourceResult =
    | Readonly<{ status: 'relinked'; relinkedClipIds: readonly string[] }>
    | Readonly<{ status: 'source-not-missing' }>
    | Readonly<{ status: 'rejected' }>;

type RelinkedClip = {
    clipId: string;
    previousAudioBufferId: string | undefined;
};

/**
 * The buffer id a clip's audio is cached under. Clips that predate explicit
 * buffer bookkeeping keep their audio under their own clip id.
 */
function resolveClipSourceBufferId(clip: Clip): string {
    return clip.audioBufferId ?? clip.id;
}

function relinkedClip(clip: Clip, sourceBufferId: string): boolean {
    return clip.type === 'audio' && resolveClipSourceBufferId(clip) === sourceBufferId;
}

function applyAudioBufferId(clip: Clip, audioBufferId: string | undefined): Clip {
    const rewritten = { ...clip };
    if (audioBufferId === undefined) {
        Reflect.deleteProperty(rewritten, 'audioBufferId');
        return rewritten;
    }
    rewritten.audioBufferId = audioBufferId;
    return rewritten;
}

function rewriteClipList(clips: readonly Clip[], overrides: ReadonlyMap<string, string | undefined>): Clip[] {
    return clips.map((clip) => {
        if (!overrides.has(clip.id)) {
            return clip;
        }
        return applyAudioBufferId(clip, overrides.get(clip.id));
    });
}

function rewriteTrack(track: Track, overrides: ReadonlyMap<string, string | undefined>): Track {
    const alternatives = track.alternatives.map((alternative): TrackAlternative => ({
        ...alternative,
        clips: rewriteClipList(alternative.clips, overrides),
    }));
    return { ...track, clips: rewriteClipList(track.clips, overrides), alternatives };
}

/**
 * Rewrite matched clips across the whole track store — active arrangement and
 * inactive track alternatives alike (an alternative switch rehydrates its
 * clips into the live track list, so a half-repaired store would resurrect the
 * silence on the next switch) — in one publication.
 *
 * Stored INACTIVE ARRANGEMENTS are deliberately out of reach: they live in
 * Project's arrangement store, which Arrangement cannot import (Project
 * imports Arrangement). Their clips keep the missing id until the user
 * switches to that arrangement, which rehydrates it into the live stores where
 * the missing-media scan re-flags it and this same repair applies — and a
 * switch clears undo history anyway, so no undo entry could honestly cover
 * both aggregates.
 */
function publishAudioBufferIds(state: TrackStoreState, overrides: ReadonlyMap<string, string | undefined>): void {
    trackStore.set({ ...state, tracks: state.tracks.map((track) => rewriteTrack(track, overrides)) });
}

function overridesFrom(
    relinks: readonly RelinkedClip[],
    resolveAudioBufferId: (relink: RelinkedClip) => string | undefined
): Map<string, string | undefined> {
    return new Map(relinks.map((relink) => [relink.clipId, resolveAudioBufferId(relink)]));
}

/**
 * Repair a missing audio source everywhere it is referenced: relink EVERY clip
 * sharing `sourceBufferId` — across tracks and across duplicated/split
 * aliases — to the replacement buffer, as the missing-media panel promises
 * ("relinking a file repairs every place it is used").
 *
 * This is the missing-media repair flow's write path. A deliberate audio swap
 * on a healthy clip stays per-clip in `replaceClipAudioBuffer`; here the
 * source id must still be missing from the cache at write time, so a healthy
 * clip's siblings can never be swept up by this use case and a clip already
 * repaired by another route (it no longer carries the source id) is never
 * clobbered.
 *
 * The relink is one undoable project edit: a single undo entry restores every
 * relinked clip's original buffer id, and redo re-applies the replacement.
 */
export function relinkClipAudioSource({
    sourceBufferId,
    replacementBufferId,
}: RelinkClipAudioSourceInput): RelinkClipAudioSourceResult {
    if (sourceBufferId.length === 0 || replacementBufferId.length === 0) {
        return { status: 'rejected' };
    }

    const state = trackStore.value;
    if (!state) {
        return { status: 'rejected' };
    }

    // Write-time re-check inside the same synchronous transaction as the
    // resolution below: a source that resolves in the cache is not missing, so
    // nothing may be relinked — whatever the caller believed.
    if (getCachedAudioBuffer({ bufferId: sourceBufferId }) !== null) {
        return { status: 'source-not-missing' };
    }

    const activeRelinks: RelinkedClip[] = [];
    const alternativeRelinks: RelinkedClip[] = [];
    const collectRelink = (relinks: RelinkedClip[], clip: Clip): void => {
        if (relinkedClip(clip, sourceBufferId)) {
            relinks.push({ clipId: clip.id, previousAudioBufferId: clip.audioBufferId });
        }
    };

    for (const track of state.tracks) {
        for (const clip of track.clips) {
            collectRelink(activeRelinks, clip);
        }
        for (const alternative of track.alternatives) {
            for (const clip of alternative.clips) {
                collectRelink(alternativeRelinks, clip);
            }
        }
    }

    const relinks = [...activeRelinks, ...alternativeRelinks];
    if (relinks.length === 0) {
        return { status: 'rejected' };
    }

    // The store's clip-write trust boundary, applied where it is defined: the
    // active clip list. Alternative clips share the owning track's clip-write
    // eligibility and are published by the same store write.
    for (const relink of activeRelinks) {
        const target = resolveEligibleClipWriteTarget({ clipId: relink.clipId });
        if (target.status !== 'eligible' || !('clipId' in target)) {
            return { status: 'rejected' };
        }
    }

    publishAudioBufferIds(
        state,
        overridesFrom(relinks, () => replacementBufferId)
    );

    // New source audio invalidates the whole pitch analysis, contour and blobs
    // alike (see `replaceClipAudioBuffer`).
    for (const relink of relinks) {
        clearClipPitchAnalysis(relink.clipId);
    }

    pushUndoEntry(
        'Relink audio source',
        () => {
            const currentState = trackStore.value;
            if (currentState) {
                publishAudioBufferIds(
                    currentState,
                    overridesFrom(relinks, (relink) => relink.previousAudioBufferId)
                );
            }
        },
        () => {
            const currentState = trackStore.value;
            if (currentState) {
                publishAudioBufferIds(
                    currentState,
                    overridesFrom(relinks, () => replacementBufferId)
                );
            }
        },
        { restoresBufferIds: [replacementBufferId] }
    );

    return { status: 'relinked', relinkedClipIds: relinks.map((relink) => relink.clipId) };
}
