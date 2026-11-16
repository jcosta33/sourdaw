let lastObservationSequence = 0;

/** Number the next observation. Every number is above all earlier ones, so two observations order by number. */
export function takeNextObservationSequence(): number {
    lastObservationSequence += 1;
    return lastObservationSequence;
}

/** The number of the most recent observation; every later one numbers above it. */
export function readLastObservationSequence(): number {
    return lastObservationSequence;
}
