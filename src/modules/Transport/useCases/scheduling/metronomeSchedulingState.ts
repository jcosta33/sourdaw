export const metronomeSchedulingState = {
    lastBeat: -1,
    firedClickTimes: new Map<number, number>(),
};

/** Float tolerance for treating two scheduled click times as the same instant. */
export const CLICK_TIME_EPSILON = 1e-4;
