/**
 * Turn one projected automation write into the command that carries it (#3568).
 *
 * The projection in `projectStripAutomationWrites` speaks targets and writes,
 * not commands, because the offline fold and the live writer consume its
 * entries differently. What the two must not disagree about is which command a
 * target takes: a strip position rides `write-parameter` in any shape, while a
 * device parameter has its own command that accepts a Step or no-value Hold. A
 * backend owning its per-device smoothing lands the value at a block boundary
 * and has nowhere to put a sample offset.
 *
 * A device ramp or smoothed write throws rather than being narrowed away. The
 * projection compiles device values as steps; the live writer adds Hold to
 * cancel an edited target's old tail. Failing here names any target compiled
 * with an unsupported value trajectory.
 */

import {
    type AudioGraphCommand,
    type AudioGraphParameterTarget,
    type AudioGraphParameterWrite,
    type AudioGraphWriteDeviceParameterCommand,
} from '../../models/AudioGraphBackend';

function deviceWrite(
    target: AudioGraphParameterTarget,
    write: AudioGraphParameterWrite
): AudioGraphWriteDeviceParameterCommand['write'] {
    if (write.shape !== 'step' && write.shape !== 'hold') {
        throw new Error(`device parameter automation compiled a ${write.shape} write for ${JSON.stringify(target)}`);
    }
    return write;
}

export function automationWriteCommand(
    target: AudioGraphParameterTarget,
    write: AudioGraphParameterWrite
): AudioGraphCommand {
    if (target.kind === 'device-parameter') {
        return { kind: 'write-device-parameter', target, write: deviceWrite(target, write) };
    }
    return { kind: 'write-parameter', target, write };
}
