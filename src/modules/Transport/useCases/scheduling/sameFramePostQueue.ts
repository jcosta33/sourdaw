import {
    SAME_FRAME_EVENT_ORDER,
    STRUCK_NOTE_RELEASE_ORDER,
    type SameFrameEventKind,
} from '#/utils/sameFrameEventOrder';

type QueuedPost = { sampleFrame: number; order: number; sequence: number; post: () => void };

/**
 * The posts one track makes to its worklet instrument in one scheduler window,
 * held until the window is complete and then posted frame by frame in
 * `SAME_FRAME_EVENT_ORDER`.
 *
 * The engines apply one frame's events in posting order, and a note posts its
 * on and its off together, so without this the order at a frame depended on which
 * window a note started in and on which clip was scheduled first: a note that
 * ended where a pedal went down was released before the pedal in one case and
 * after it in the other. Sorting the window's posts removes that dependence;
 * posts of earlier windows are always ahead of these, which is the same order.
 */
export type SameFramePostQueue = {
    add: (kind: SameFrameEventKind, sampleFrame: number, post: () => void) => void;
    /** As `add`, for a release that falls on the frame its own note starts. */
    addStruckNoteRelease: (sampleFrame: number, post: () => void) => void;
    /** Post everything queued, in order, stopping as soon as `isCurrent` turns false. */
    flush: (isCurrent: () => boolean) => void;
};

export function createSameFramePostQueue(): SameFramePostQueue {
    const queued: QueuedPost[] = [];

    function enqueue(order: number, sampleFrame: number, post: () => void): void {
        queued.push({ sampleFrame, order, sequence: queued.length, post });
    }

    return {
        add: (kind, sampleFrame, post) => enqueue(SAME_FRAME_EVENT_ORDER[kind], sampleFrame, post),
        addStruckNoteRelease: (sampleFrame, post) => enqueue(STRUCK_NOTE_RELEASE_ORDER, sampleFrame, post),
        flush: (isCurrent) => {
            queued.sort(
                (alpha, beta) =>
                    alpha.sampleFrame - beta.sampleFrame || alpha.order - beta.order || alpha.sequence - beta.sequence
            );
            for (const entry of queued) {
                if (!isCurrent()) {
                    return;
                }
                entry.post();
            }
            queued.length = 0;
        },
    };
}
