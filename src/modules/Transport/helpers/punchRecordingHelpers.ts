/**
 * Punch recording ID counters — shared by punch recording use cases.
 */

let captureId = 1;
let punchId = 1;

export function getNextCaptureId(): string {
    return `cap-${captureId++}`;
}

export function getNextPunchId(): string {
    return `punch-${punchId++}`;
}
