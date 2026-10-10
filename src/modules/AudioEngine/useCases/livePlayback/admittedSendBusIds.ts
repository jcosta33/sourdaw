/**
 * Bus ids a strip's sends may actually address (#3068).
 *
 * The admission `projectLiveGraphTopology.ts`'s own `sendCommands` applies to
 * the topology batch, stated here as a standalone predicate so
 * `projectLiveAutomationWrites.ts` can apply it identically to a send-level
 * automation target: a send the topology drops carries no `add-send`
 * command, so a lane automating it must not receive writes either, or the
 * automation would name a path the graph never built.
 *
 * A send naming no built bus carries no audio path in the project either, so
 * dropping it is the same answer the export path gives. The source may be a
 * track or a bus: bus into bus is ordinary practice — a reverb feeding a
 * parallel compressor — and the native bus strip carries the same send taps a
 * track strip does (#5067).
 */

import { type Track } from '#/modules/Arrangement/stores';

export function admittedSendBusIds(input: { track: Track; busStripIds: ReadonlySet<string> }): readonly string[] {
    const { track, busStripIds } = input;
    return track.sends.filter((send) => busStripIds.has(send.busId)).map((send) => send.busId);
}
