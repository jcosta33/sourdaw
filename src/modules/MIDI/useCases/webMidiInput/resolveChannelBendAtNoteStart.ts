import { PITCH_BEND_CENTER } from '#/utils/midiData';

import { MPE_FIRST_MEMBER_CHANNEL, MPE_MASTER_CHANNEL } from '../../models/MidiControllerState';
import { type AdmittedChannelWheels } from '../../repositories/webMidi/captureAdmittedWheels';
import { channelPitchBendState } from '../../repositories/webMidi/channelPitchBendState';

import { resolveBendRangeSemitones } from './resolveBendRangeSemitones';

const CENTS_PER_SEMITONE = 100;

type ResolveChannelBendAtNoteStartInput = {
    /** Zero-based MIDI channel the note is struck on. */
    channel: number;
    /** Whether MPE input handling is active for the current device. */
    mpeEnabled: boolean;
    /** The bend the note already carries as its own per-note data, if any. */
    ownPitchBend: number | undefined;
    /**
     * The wheels captured when the note-on was admitted. A note-on that did not
     * come through admission (the on-screen keyboard) has none and reads the
     * wheel as it stands.
     */
    admittedWheels?: AdmittedChannelWheels;
};

type ReadWheelInput = {
    bendChannel: number;
    isMember: boolean;
    admittedWheels: AdmittedChannelWheels | undefined;
};

function readWheel({ bendChannel, isMember, admittedWheels }: ReadWheelInput): number {
    if (!admittedWheels) {
        return channelPitchBendState.get(bendChannel) ?? 0;
    }
    return isMember ? admittedWheels.master : admittedWheels.channel;
}

export type ChannelBendAtNoteStart = {
    /** Signed 14-bit wire delta the note starts under. */
    pitchBend: number;
    /** Range the bend was performed against, in semitones. */
    bendRangeSemitones: number;
    /** The same bend as a detune in cents, for the built-in oscillator. */
    detuneCents: number;
};

/**
 * The channel bend a note starts under, or `undefined` when it starts unbent.
 *
 * Pitch bend is channel state: every synth starts a note at the bend its
 * channel holds, and stored playback does the same. A non-MPE note takes its
 * own channel's wheel. An MPE member-channel note keeps its per-note bend
 * (nothing is added when it has one) and otherwise starts under the zone
 * master's wheel, which reaches every member channel. A centred wheel returns
 * `undefined`, so no event is posted for it.
 */
export function resolveChannelBendAtNoteStart({
    channel,
    mpeEnabled,
    ownPitchBend,
    admittedWheels,
}: ResolveChannelBendAtNoteStartInput): ChannelBendAtNoteStart | undefined {
    const isMember = mpeEnabled && channel >= MPE_FIRST_MEMBER_CHANNEL;
    if (isMember && ownPitchBend !== undefined) {
        return undefined;
    }

    const bendChannel = isMember ? MPE_MASTER_CHANNEL : channel;
    const pitchBend = readWheel({ bendChannel, isMember, admittedWheels });
    if (pitchBend === 0) {
        return undefined;
    }

    const bendRangeSemitones = resolveBendRangeSemitones({ channel: bendChannel, mpeEnabled });
    return {
        pitchBend,
        bendRangeSemitones,
        detuneCents: (pitchBend / PITCH_BEND_CENTER) * bendRangeSemitones * CENTS_PER_SEMITONE,
    };
}
