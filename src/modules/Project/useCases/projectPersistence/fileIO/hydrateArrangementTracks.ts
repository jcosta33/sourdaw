import {
    type ProjectClip as SerializedProjectClip,
    type ProjectTrackAlternative as SerializedProjectTrackAlternative,
} from '../../../models/ProjectData';
import { type ProjectClip, type ProjectTrack, type ProjectTrackAlternative } from '../../../stores/arrangementStore';
import { type HydratableProjectTrack } from '../helpers/isHydratableProjectData';

function hydrateClip(clip: SerializedProjectClip): ProjectClip {
    return {
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        type: clip.type,
        audioBufferId: clip.bufferId ?? clip.audioBufferId,
        fileId: clip.fileId,
        assetHash: clip.assetHash,
        audioOffsetBeats: clip.sampleStartBeat ?? clip.audioOffsetBeats,
        midiOffsetBeats: clip.midiOffsetBeats,
        fadeInBeats: clip.fadeInBeats,
        fadeOutBeats: clip.fadeOutBeats,
        gain: clip.gain,
        color: clip.color,
        locked: clip.locked,
        muted: clip.muted,
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
        kneadState: clip.kneadState,
    };
}

function hydrateAlternative(alternative: SerializedProjectTrackAlternative): ProjectTrackAlternative {
    return {
        id: alternative.id,
        name: alternative.name,
        clips: alternative.clips.map(hydrateClip),
    };
}

function hydrateTrack(track: HydratableProjectTrack): ProjectTrack {
    const defaultAlternativeId = `${track.id}-alt-default`;
    const alternatives = track.alternatives?.map(hydrateAlternative) ?? [
        { id: defaultAlternativeId, name: 'Alternative 1', clips: [] },
    ];
    return {
        id: track.id,
        name: track.name,
        kind: track.kind,
        muted: track.muted ?? false,
        soloed: track.soloed ?? false,
        armed: track.armed ?? false,
        gain: track.gain ?? 0.8,
        pan: track.pan ?? 0,
        color: track.color ?? '',
        clips: track.clips.map(hydrateClip),
        devices: track.devices ?? [],
        sends: track.sends ?? [],
        midiFx: track.midiFx ?? [],
        frozen: track.frozen ?? false,
        frozenBufferId: track.frozenBufferId,
        freezeState: track.freezeState ?? { status: 'unfrozen' },
        parentId: track.parentId ?? null,
        collapsed: track.collapsed ?? false,
        inputMonitoring: track.inputMonitoring ?? 'auto',
        hidden: track.hidden ?? false,
        disabled: track.disabled ?? false,
        height: track.height || 80,
        outputId: track.outputId ?? (track.kind === 'master' ? 'hw_out' : 'master'),
        automationMode: track.automationMode ?? 'read',
        groupId: track.groupId ?? null,
        soloSafe: track.soloSafe ?? track.kind === 'bus',
        notes: track.notes ?? '',
        inputId: track.inputId ?? null,
        activeAlternativeId: track.activeAlternativeId ?? alternatives[0]?.id ?? defaultAlternativeId,
        alternatives,
        vcaGroupId: track.vcaGroupId ?? null,
        midiOutputTrackId: track.midiOutputTrackId ?? null,
        followChordTrack: track.followChordTrack ?? false,
        showVariationLanes: track.showVariationLanes,
    };
}

export function hydrateArrangementTracks(tracks: readonly HydratableProjectTrack[]): ProjectTrack[] {
    return tracks.map(hydrateTrack);
}
