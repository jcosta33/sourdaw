import { PITCH_BEND_CENTER } from '#/utils/midiData';

import { channelPitchBendState } from './channelPitchBendState';

/**
 * Record a pitch bend the input has received as its channel's wheel.
 *
 * The wheel describes the physical controller, not the session, so it is
 * written when the message is admitted, in arrival order. Writing it from the
 * per-channel queue would let a session fence (transport reset, target change,
 * MPE toggle) discard a queued bend and leave an earlier position standing for
 * every later note on the channel.
 */
export function admitPitchBend(channel: number, lsb: number, msb: number): void {
    channelPitchBendState.set(channel, ((msb << 7) | lsb) - PITCH_BEND_CENTER);
}
