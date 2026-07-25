import { audioEngine } from '#/modules/AudioEngine/useCases';

/**
 * Scheduling budget for live input, in frames — one render quantum.
 *
 * A worklet dispatches a scheduled message at the boundary of the block its
 * `sampleFrame` falls into; there is no sub-block splitting of the DSP call.
 * A budget smaller than one quantum therefore cannot move a note into a
 * different block and buys nothing. One quantum (2.7 ms at 48 kHz, 2.9 ms at
 * 44.1 kHz) is the smallest offset that lets an event which arrived a moment
 * ago still be placed *ahead* of the render position instead of being
 * flattened onto it.
 *
 * This is a latency-for-accuracy trade, deliberately set at the minimum that
 * can help: raising it absorbs more main-thread jitter at the cost of live
 * monitoring latency. Past the budget the frame clamps to now, which is
 * exactly the behaviour that predates this — the trade never makes a late
 * note later.
 */
const LIVE_INPUT_SCHEDULING_OFFSET_FRAMES = 128;

type ResolveInputDispatchFrameInput = {
    /** Arrival instant on the AudioContext clock, from `resolveInputEventTime`. */
    eventTime: number;
};

/**
 * Absolute audio-thread frame a live event should be voiced at (audit MD-1).
 *
 * Never returns a frame the render position has already passed, so a note
 * whose handler ran too late to place accurately still sounds immediately
 * rather than being dropped or scheduled into the past.
 */
export function resolveInputDispatchFrame({ eventTime }: ResolveInputDispatchFrameInput): number {
    const context = audioEngine.context;
    const earliestFrame = Math.round(context.currentTime * context.sampleRate);
    const arrivalFrame = Math.round(eventTime * context.sampleRate);
    return Math.max(earliestFrame, arrivalFrame + LIVE_INPUT_SCHEDULING_OFFSET_FRAMES);
}
