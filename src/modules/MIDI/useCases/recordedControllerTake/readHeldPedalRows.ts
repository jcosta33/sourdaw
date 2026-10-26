import { getMidiLearnState } from '#/modules/ControlSurface/useCases';
import { isPedalControllerLift } from '#/utils/pianoPedalController';

import { HELD_PEDAL_CONTROLLERS } from '../../models/MidiControllerState';
import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { heldPedalState } from '../../repositories/webMidi/heldPedalState';
import { admitsRecordedControlChange } from '../webMidiInput/recordedControlChangeAdmission';

/**
 * The pedals held down on the live input right now that the live route would
 * record, as rows at clip beat 0, channel by channel. A pedal is held by the
 * test stored playback applies (`isPedalControllerLift`), so a switch pedal
 * below its latch threshold has no row, like a pedal at rest, and neither has
 * one the route keeps out of a take (a learned mapping owns it): the take would
 * hold its press with no lift.
 */
export function readHeldPedalRows(): MidiCC[] {
    const learnState = getMidiLearnState();
    const mpeEnabled = getMpeEnabled();
    const channels = [...heldPedalState].sort(([first], [second]) => first - second);
    return channels.flatMap(([channel, pedals]) =>
        HELD_PEDAL_CONTROLLERS.flatMap((controller) => {
            const value = pedals.get(controller) ?? 0;
            const admitted = admitsRecordedControlChange({
                learnState,
                mpeEnabled,
                channel,
                cc: controller,
                resolvedCc: controller,
                consumed: false,
            });
            if (!admitted || isPedalControllerLift(controller, value)) {
                return [];
            }
            return [createMidiCC(controller, value, 0, channel)];
        })
    );
}
