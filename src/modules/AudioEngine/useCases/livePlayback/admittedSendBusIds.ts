/**
 * Bus ids a track's sends may actually address (#3068).
 *
 * The admission `projectLiveGraphTopology.ts`'s own `sendCommands` applies to
 * the topology batch, stated here as a standalone predicate so
 * `projectLiveAutomationWrites.ts` can apply it identically to a send-level
 * automation target: a send the topology drops carries no `add-send`
 * command, so a lane automating it must not receive writes either, or the
 * automation would name a path the graph never built.
 *
 * A send naming no built bus carries no audio path in the project either, so
 * dropping it is the same answer the export path gives. A send *from* a bus
 * does carry one — bus into bus is ordinary practice, a reverb feeding a
 * parallel compressor — but the native send tap sits on track strips only, so
 * the engine refuses a bus-source send by name. What that path costs until the
 * tap exists is its own audio, and growing one is engine fidelity work, never
 * a producer emitting a command the engine refuses.
 */

import { type Track } from '#/modules/Arrangement/stores';

export function admittedSendBusIds(input: { track: Track; busStripIds: ReadonlySet<string> }): readonly string[] {
    const { track, busStripIds } = input;
    if (track.kind === 'bus') {
        return [];
    }
    return track.sends.filter((send) => busStripIds.has(send.busId)).map((send) => send.busId);
}
