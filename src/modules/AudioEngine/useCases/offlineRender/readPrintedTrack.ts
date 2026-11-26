import { type Track } from '#/modules/Arrangement/stores';

import { projectStripTrack } from './projectStripTrack';
import { readPlayedFrozenBufferId } from './readPlayedFrozenBufferId';

/**
 * Reads the track fields a subgraph render consumes: strip topology and mixing (`kind`, `gain`,
 * `pan`, `sends`, `parentId`, `disabled`, `outputId`, VCA membership), what it plays (`clips`,
 * `devices`), how it reads automation and the chord track (`automationMode`, `followChordTrack`),
 * and freeze state. Every other field (naming, layout, recording setup, solo, MIDI FX, the MIDI
 * output route and the stored alternatives) has no reader in the offline render. Reading by an
 * allowlist keeps a field a later change adds to `Track` out of the print until a reader needs it.
 */
function pickRenderedFields(track: Track) {
    return {
        id: track.id,
        kind: track.kind,
        muted: track.muted,
        gain: track.gain,
        pan: track.pan,
        clips: track.clips,
        devices: track.devices,
        sends: track.sends,
        parentId: track.parentId,
        disabled: track.disabled,
        automationMode: track.automationMode,
        followChordTrack: track.followChordTrack,
        outputId: track.outputId,
        vcaGroupId: track.vcaGroupId,
        frozen: track.frozen,
        frozenBufferId: track.frozenBufferId,
    };
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
    const { muted, vcaGroupId, frozen, frozenBufferId, outputId, ...read } = pickRenderedFields(strip);
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
