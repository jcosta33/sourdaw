let lastWriteSequence = 0;

/**
 * Number the scheduler's next write to a device parameter. Only the scheduler's automation pass calls
 * this, through the use-case folder; it is not on the `stores/` barrel, so foreign modules only read.
 */
export function takeNextAutomationWriteSequence(): number {
    lastWriteSequence += 1;
    return lastWriteSequence;
}

/** The sequence of the most recent scheduler write to any parameter; every later write numbers above it. */
export function readLastAutomationWriteSequence(): number {
    return lastWriteSequence;
}
