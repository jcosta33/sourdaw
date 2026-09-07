/**
 * Turn one projected automation write into the command that carries it (#3568).
 *
 * The projection in `projectStripAutomationWrites` speaks targets and writes,
 * not commands, because the offline fold and the live writer consume its
 * entries differently. What the two must not disagree about is which command a
 * target takes: a strip position rides `write-parameter` in any shape, while a
 * device parameter has its own command that only accepts a step, because a
 * backend owning its per-device smoothing lands the value at a block boundary
 * and has nowhere to put a sample offset.
 *
 * A non-step write aimed at a device parameter throws rather than being
 * narrowed away. The projection compiles device automation as steps by
 * construction, so one arriving in any other shape means that law changed and
 * the caller is about to send a command the backend refuses; failing here names
 * the target that produced it.
 */

import {
    type AudioGraphCommand,
    type AudioGraphParameterTarget,
    type AudioGraphParameterWrite,
    type AudioGraphStepWrite,
} from '../../models/AudioGraphBackend';

function stepWrite(target: AudioGraphParameterTarget, write: AudioGraphParameterWrite): AudioGraphStepWrite {
    if (write.shape !== 'step') {
        throw new Error(`device parameter automation compiled a ${write.shape} write for ${JSON.stringify(target)}`);
    }
    return write;
}

export function automationWriteCommand(
    target: AudioGraphParameterTarget,
    write: AudioGraphParameterWrite
): AudioGraphCommand {
    if (target.kind === 'device-parameter') {
        return { kind: 'write-device-parameter', target, write: stepWrite(target, write) };
    }
    return { kind: 'write-parameter', target, write };
}
