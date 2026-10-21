import { HELD_PEDAL_CONTROLLERS } from '../../models/MidiControllerState';
import { channelControllerState } from '../../repositories/webMidi/channelControllerState';
import { type RecordedCcRow } from '../../repositories/webMidi/recordedControllerTakeState';

/**
 * The pedals held down on the live input right now, as rows at clip beat 0,
 * channel by channel. A pedal at rest has no row.
 */
export function readHeldPedalRows(): RecordedCcRow[] {
    const channels = [...channelControllerState].sort(([first], [second]) => first - second);
    return channels.flatMap(([channel, state]) =>
        HELD_PEDAL_CONTROLLERS.flatMap((controller) => {
            const value = state.heldPedals.get(controller) ?? 0;
            return value > 0 ? [{ controller, value, beat: 0, channel }] : [];
        })
    );
}
