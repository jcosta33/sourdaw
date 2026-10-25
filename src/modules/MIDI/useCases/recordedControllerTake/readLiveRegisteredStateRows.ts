import { MPE_FIRST_MEMBER_CHANNEL } from '../../models/MidiControllerState';
import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import { channelControllerState } from '../../repositories/webMidi/channelControllerState';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { declareChannelState } from '../../services/registeredParameterState';

/**
 * The registered-parameter state each channel of the live input is in, as the
 * ordered declaration that reaches it (`declareChannelState`), at clip beat 0,
 * channel by channel. A channel whose declaration is the fresh channel's (empty)
 * has none, and neither has an MPE member channel, whose bend is per-note data
 * and never a channel row.
 */
export function readLiveRegisteredStateRows(): MidiCC[] {
    const mpeEnabled = getMpeEnabled();
    const channels = [...channelControllerState].sort(([first], [second]) => first - second);
    return channels.flatMap(([channel, state]) => {
        if (mpeEnabled && channel >= MPE_FIRST_MEMBER_CHANNEL) {
            return [];
        }
        return declareChannelState(state).map(({ controller, value }) => createMidiCC(controller, value, 0, channel));
    });
}
