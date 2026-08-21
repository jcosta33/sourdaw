import { type Clip, type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectClip, type ProjectTrack, type ProjectTrackAlternative } from '../../../models/ProjectData';

import { serializeProjectMidiNote } from './serializeProjectMidiNote';

/**
 * This file is the authority for track, clip, and automation field names on the
 * wire. `hydrateArrangementTracks.ts` is its inverse and must move with it.
 *
 * The Rust side deliberately does not mirror these names: `crates/daw-collab`'s
 * `schema.rs` owns the root document's keys only. A second definition of the
 * same shape in another language is not checked against this one, so a rename
 * there would keep compiling and only surface when a user opens a shared
 * project and finds fields missing.
 */

/** Per-clip note map as exported alongside the arrangement. */
type NotesByClipId = MidiStoreState['notesByClipId'];

/**
 * Map a runtime arrangement {@link Clip} onto the serialized {@link ProjectClip}
 * shape written into a `.sourdaw` file.
 *
 * The two clip types diverge on audio fields: the runtime store names the
 * sample reference `audioBufferId` and its in-clip offset `audioOffsetBeats`,
 * while the serialized schema names them `bufferId` and `sampleStartBeat`. The
 * export previously wrote the runtime clip straight into the serialized slot, so
 * the import's `clip.bufferId` lookup never resolved and no audio buffers were
 * restored from IDB. Mapping the field names here is what makes the import side
 * resolve referenced buffer ids.
 *
 * Runtime clips carry no inline MIDI notes — a clip's notes live in the MIDI
 * store keyed by clip id. The optional `notesByClipId` map supplies them so the
 * exported clip carries its notes inline (mirroring the import-side read).
 */
function serializeClip(clip: Clip, notesByClipId?: NotesByClipId): ProjectClip {
    const notes = notesByClipId?.[clip.id];
    return {
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        type: clip.type,
        fadeInBeats: clip.fadeInBeats,
        fadeOutBeats: clip.fadeOutBeats,
        gain: clip.gain,
        color: clip.color,
        locked: clip.locked,
        muted: clip.muted,
        bufferId: clip.audioBufferId,
        sampleStartBeat: clip.audioOffsetBeats,
        fileId: clip.fileId,
        assetHash: clip.assetHash,
        midiOffsetBeats: clip.midiOffsetBeats,
        stretchMode: clip.stretchMode,
        stretchRatio: clip.stretchRatio,
        loopEnabled: clip.loopEnabled,
        loopLength: clip.loopLength,
        followAction: clip.followAction,
        generating: clip.generating,
        isGhost: clip.isGhost,
        isInlineEditing: clip.isInlineEditing,
        parentClipId: clip.parentClipId,
        isLinkedInstance: clip.isLinkedInstance,
        sourceKeyRoot: clip.sourceKeyRoot,
        sourceScaleName: clip.sourceScaleName,
        overrides: clip.overrides,
        notes: notes ? notes.map(serializeProjectMidiNote) : undefined,
        kneadState: clip.kneadState,
    };
}

function serializeAlternative(
    alt: Track['alternatives'][number],
    notesByClipId?: NotesByClipId
): ProjectTrackAlternative {
    return {
        id: alt.id,
        name: alt.name,
        clips: alt.clips.map((clip) => serializeClip(clip, notesByClipId)),
    };
}

function serializeTrack(track: Track, notesByClipId?: NotesByClipId): ProjectTrack {
    return {
        ...track,
        clips: track.clips.map((clip) => serializeClip(clip, notesByClipId)),
        alternatives: track.alternatives.map((alt) => serializeAlternative(alt, notesByClipId)),
    };
}

/**
 * Serialize a runtime track list into the `.sourdaw` arrangement track shape,
 * mapping each clip's runtime audio fields onto the serialized names. The
 * optional `notesByClipId` map (from the MIDI store) supplies note arrays for
 * clips whose notes live in the MIDI store rather than inline on the clip.
 */
export function serializeArrangementTracks(tracks: readonly Track[], notesByClipId?: NotesByClipId): ProjectTrack[] {
    return tracks.map((track) => serializeTrack(track, notesByClipId));
}
