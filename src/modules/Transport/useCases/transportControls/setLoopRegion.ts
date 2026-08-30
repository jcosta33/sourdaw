import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setLoopRegion(startBeat: number, endBeat: number, enableLooping = true): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // Normalise the region before committing it. The scheduler only loops when
    // `loopEnd > loopStart` (playheadScheduler `tick`), so an inverted region
    // with `isLooping: true` would silently disable looping while the UI shows
    // it as enabled. Order the bounds and clamp the start to the timeline
    // origin so the stored region is always a valid forward span.
    const loopStart = Math.max(0, Math.min(startBeat, endBeat));
    const loopEnd = Math.max(startBeat, endBeat);

    if (!enableLooping) {
        updateTransportState({ loopStart, loopEnd });
        return;
    }

    // A degenerate (zero-length) region cannot loop; keep the bounds but leave
    // looping disabled rather than asserting an enabled loop the scheduler will
    // ignore.
    const isLooping = loopEnd > loopStart;
    updateTransportState({ loopStart, loopEnd, isLooping });
}
