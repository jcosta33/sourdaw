import { getMidiLearnState } from '#/modules/ControlSurface/useCases';

import { HELD_PEDAL_CONTROLLERS } from '../../models/MidiControllerState';
import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { heldPedalState } from '../../repositories/webMidi/heldPedalState';
import { admitsRecordedControlChange } from '../webMidiInput/recordedControlChangeAdmission';

/**
 * The pedals held down on the live input right now that the live route would
 * record, as rows at clip beat 0, channel by channel. A pedal at rest has no
 * row, and neither has one the route keeps out of a take (a learned mapping owns
 * it): the take would hold its press with no lift.
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
            return value > 0 && admitted ? [createMidiCC(controller, value, 0, channel)] : [];
        })
    );
}
