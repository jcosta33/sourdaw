/**
 * Transport-owned shared runtime timer state. This is not project truth:
 * it is only the pending count-in timeout handle, cleared by the recording
 * lifecycle before recording is stopped or cancelled.
 */
export let countInTimerId: ReturnType<typeof setTimeout> | null = null;

export function setCountInTimerId(id: ReturnType<typeof setTimeout> | null): void {
    countInTimerId = id;
}
