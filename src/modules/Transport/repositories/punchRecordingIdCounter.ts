/**
 * Punch recording ID counters — single source of truth for capture/punch IDs.
 * All use cases that create punch captures or punch regions must use these counters.
 */

let captureId = 1;
let punchId = 1;

export function getNextCaptureId(): string {
    return `cap-${captureId++}`;
}

export function getNextPunchId(): string {
    return `punch-${punchId++}`;
}
