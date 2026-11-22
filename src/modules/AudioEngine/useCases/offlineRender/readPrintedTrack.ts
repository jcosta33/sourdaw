import { type Track } from '#/modules/Arrangement/stores';

import { projectStripTrack } from './projectStripTrack';
import { readPlayedFrozenBufferId } from './readPlayedFrozenBufferId';

/**
 * Track fields no subgraph render reads: naming, layout and lane display, recording and monitoring
 * setup, edit grouping, the stored inactive alternatives, and solo (a freeze or bounce prints every
 * strip it builds whatever is soloed: it passes `resolvePrintReachability` no solo gate).
 */
type UnreadTrackField =
    | 'name'
    | 'color'
    | 'height'
    | 'collapsed'
    | 'hidden'
    | 'notes'
    | 'showVariationLanes'
    | 'armed'
    | 'inputMonitoring'
    | 'inputId'
    | 'groupId'
    | 'alternatives'
    | 'soloed'
    | 'soloSafe';

function omitUnreadFields(track: Track): Omit<Track, UnreadTrackField> {
    const {
        name: _name,
        color: _color,
        height: _height,
        collapsed: _collapsed,
        hidden: _hidden,
        notes: _notes,
        showVariationLanes: _showVariationLanes,
        armed: _armed,
        inputMonitoring: _inputMonitoring,
        inputId: _inputId,
        groupId: _groupId,
        alternatives: _alternatives,
        soloed: _soloed,
        soloSafe: _soloSafe,
        ...read
    } = track;
    return read;
}

type ReadPrintedTrackInput = {
    track: Track;
    isTarget: boolean;
    /** Whether the render honours this track's mute (a sidechain key source). */
    honoursMute: boolean;
};

/**
 * The fields of one strip a keep-live subgraph render (a freeze) reads, by the render's own rules:
 * the target at unity and centre with no VCA master, freeze state or output of its own (it prints),
 * and a mute only where the render honours one. Both the print's signature and its change detection
 * read a track through this, so a write to any other field changes neither.
 */
export function readPrintedTrack({ track, isTarget, honoursMute }: ReadPrintedTrackInput) {
    const strip = projectStripTrack({
        track,
        isTarget,
        includeInserts: true,
        includeAutomation: true,
        targetMixer: 'keepLive',
    });
    const {
        muted,
        vcaGroupId,
        freezeState: _freezeState,
        frozen,
        frozenBufferId,
        outputId,
        ...read
    } = omitUnreadFields(strip);
    const printed = { ...read, muted: honoursMute ? muted : null };
    if (isTarget) {
        return printed;
    }
    return {
        ...printed,
        vcaGroupId,
        outputId,
        frozen,
        frozenBufferId,
        playedFrozenBufferId: readPlayedFrozenBufferId(track),
    };
}
