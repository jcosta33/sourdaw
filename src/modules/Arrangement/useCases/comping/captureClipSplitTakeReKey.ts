import { captureTakeReKeyTransitions } from './captureTakeReKeyTransitions';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

type CaptureClipSplitTakeReKeyInput = {
    /** The track whose lane holds the split clip's takes. */
    trackId: string;
    clipId: string;
    /** The fresh id the right fragment carries — the plan's committed id. */
    rightClipId: string;
    /** The exact resolved split beat the clip plan committed to. */
    splitBeat: number;
    clipStartBeat: number;
    clipEndBeat: number;
};

/**
 * Read-only half of the split re-key (#5048): how one clip split distributes
 * every take and comp region across the two fragments. Two windows — the left
 * keeps the clip id (the split convention), the right names the fresh fragment
 * id — so a take crossing the seam fragments the same way Delete Time splits
 * one (the left fragment keeps the take id, the right mints the deterministic
 * one) and a region spanning the seam maps onto both fragment takes instead of
 * staying bounded by the left clip's end. Splitting changes no audio: the comp
 * keeps sounding its take across both fragments. Returns [] when no lane holds
 * takes for the clip, so an un-comped split costs no take write.
 */
export function captureClipSplitTakeReKeyTransitions(
    input: CaptureClipSplitTakeReKeyInput
): readonly TakeReKeyLaneTransition[] {
    return captureTakeReKeyTransitions({
        windowsByTrackId: new Map([
            [
                input.trackId,
                [
                    {
                        sourceClipId: input.clipId,
                        targetClipId: input.clipId,
                        sourceStartBeat: input.clipStartBeat,
                        sourceEndBeat: input.splitBeat,
                        targetStartBeat: input.clipStartBeat,
                        targetEndBeat: input.splitBeat,
                    },
                    {
                        sourceClipId: input.clipId,
                        targetClipId: input.rightClipId,
                        sourceStartBeat: input.splitBeat,
                        sourceEndBeat: input.clipEndBeat,
                        targetStartBeat: input.splitBeat,
                        targetEndBeat: input.clipEndBeat,
                    },
                ],
            ],
        ]),
        removedClipIds: new Set<string>(),
        deleteStartBeat: input.splitBeat,
        deleteEndBeat: input.splitBeat,
        operationKind: 'clip-transform',
    });
}
