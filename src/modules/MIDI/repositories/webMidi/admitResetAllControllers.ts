import { channelPitchBendState } from './channelPitchBendState';

/**
 * Recentre a channel's wheel on the Reset All Controllers it has received.
 * Written on admission for the same reason as `admitPitchBend`.
 */
export function admitResetAllControllers(channel: number): void {
    channelPitchBendState.delete(channel);
}
