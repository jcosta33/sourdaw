import { logger } from '#/infra/logger/appLogger';

/**
 * The most recent retrospective arm or disarm request, settled or not.
 *
 * The native commands behind these requests each run as an independent task
 * in the main process, with no ordering between them: an arm waits on the
 * graph registry an in-flight batch may hold, while a disarm does not. Two in
 * flight at once can therefore finish in the reverse of the order they were
 * issued, leaving the engine retaining input while punch shows disabled. Each
 * request is sent only once the previous one has settled, so the order the
 * renderer issues them is the order the main process applies them.
 *
 * Never rejects: a failed request is logged and the next one still goes out.
 */
let lastRequest: Promise<void> = Promise.resolve();

/**
 * Send `request` once every earlier retrospective arm or disarm request has
 * settled, resolved or rejected.
 */
export function sendRetrospectiveCaptureRequestInOrder(request: () => Promise<unknown>): void {
    lastRequest = lastRequest.then(request).then(ignoreResult, logRejectedRequest);
}

function ignoreResult(): void {}

function logRejectedRequest(error: unknown): void {
    logger.error(error instanceof Error ? error : new Error(String(error)));
}
