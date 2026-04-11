/**
 * Punch recording ID counters — single source of truth for capture/punch IDs.
 * All use cases that create punch captures or punch regions must use these counters.
 */

let captureId = 1;

export function getNextCaptureId(): string {
    return `cap-${captureId++}`;
}