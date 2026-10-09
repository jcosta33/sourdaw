import { captureTakeReKeyTransitions } from './captureTakeReKeyTransitions';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

type CaptureClipMoveTakeReKeyInput = {
    /**
     * The track whose lane holds the moved clip's takes. Only a same-host move
     * has one: a lane is per-track, so carrying a comp to another track is a
     * lane migration no route owns yet — a cross-host move leaves the comp
     * behind, as before this capture existed.
     */
    trackId: string;
    clipId: string;
    fromStartBeat: number;
    fromEndBeat: number;
    toStartBeat: number;
    toEndBeat: number;
};

/**
 * Read-only half of the move re-key (#5100): how one same-host clip move shifts
 * every take and comp region keyed to that clip. One whole-clip window carries
 * the clip's material from its old span to the new one, so each take re-keys
 * onto the shifted span under its own id and each region shifts with it — the
 * comping travels with the clip, the way a take folder does. Returns [] when no
 * lane holds takes for the clip, so an un-comped move costs no take write.
 */
export function captureClipMoveTakeReKeyTransitions(
    input: CaptureClipMoveTakeReKeyInput
): readonly TakeReKeyLaneTransition[] {
    return captureTakeReKeyTransitions({
        windowsByTrackId: new Map([
            [
                input.trackId,
                [
                    {
                        sourceClipId: input.clipId,
                        targetClipId: input.clipId,
                        sourceStartBeat: input.fromStartBeat,
                        sourceEndBeat: input.fromEndBeat,
                        targetStartBeat: input.toStartBeat,
                        targetEndBeat: input.toEndBeat,
                    },
                ],
            ],
        ]),
        removedClipIds: new Set<string>(),
        deleteStartBeat: input.fromStartBeat,
        deleteEndBeat: input.fromEndBeat,
        operationKind: 'clip-transform',
    });
}
