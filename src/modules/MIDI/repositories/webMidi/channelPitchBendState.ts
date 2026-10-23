/**
 * The last pitch bend received on each channel, per zero-based MIDI channel,
 * as the signed 14-bit wire delta (-8192..8191, 0 = centre). An MPE member
 * channel's bend is recorded too, though its notes keep it per-note, so the
 * channel is right when MPE is later switched off.
 *
 * Pitch bend is channel state in MIDI: a note struck on a channel starts under
 * the bend that channel holds, and a bend moves only that channel's notes. An
 * absent entry is a wheel at centre. Like `heldPedalState`, the wheel is a fact
 * about the physical controller, so a transport stop, pause or seek leaves it
 * standing. It is dropped when the input device is reset or torn down, and per
 * channel by Reset All Controllers, which recentres it.
 */
export const channelPitchBendState = new Map<number, number>();
