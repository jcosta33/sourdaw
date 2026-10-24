import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';

import { activeRecordingRef } from '../../stores/activeRecordingRef';

/**
 * Whether the take currently being recorded owns the live project root.
 * Mirrors the Stop finaliser's entry check (#5517): a null witness is a legacy
 * in-flight take and always reads as owning. Callers that decide BEFORE
 * calling stopRecording get the same answer the finaliser will act on, in the
 * same tick.
 */
export function takeOwnsRecordingRoot(): boolean {
    const witness = activeRecordingRef.capturedRootIdentity ?? null;
    return witness === null || captureProjectRootIdentity() === witness;
}
