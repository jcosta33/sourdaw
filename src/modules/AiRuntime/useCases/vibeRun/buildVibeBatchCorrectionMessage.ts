import { type ToolCallResult } from '../../models/ToolCallResult';

import { type VibeBatchValueRequest } from './buildVibeBatchValueRequest';

/** A refused reply is quoted back to the provider in its correction, never more than this. */
export const VIBE_BATCH_REFUSED_REPLY_ECHO_MAX_CHARS = 4_000;
/** The rejection reason a correction states, never more than this. */
export const VIBE_BATCH_REJECTION_REASON_MAX_CHARS = 500;

const CORRECTION_INSTRUCTION =
    'Your previous reply was refused for the reason given in rejection, and nothing of it was applied. Reply again to the same request, calling exactly one tool once.';

/** The correction is a fresh request: the original content, the refused reply and why it was refused. */
export function buildVibeBatchCorrectionMessage(
    request: VibeBatchValueRequest,
    calls: readonly ToolCallResult[],
    reason: string
): string {
    const original: unknown = JSON.parse(request.userMessage);
    const refusedReply = JSON.stringify(calls.map((call) => ({ name: call.name, arguments: call.arguments }))).slice(
        0,
        VIBE_BATCH_REFUSED_REPLY_ECHO_MAX_CHARS
    );
    return JSON.stringify({
        request: original,
        refusedReply,
        rejection: reason.slice(0, VIBE_BATCH_REJECTION_REASON_MAX_CHARS),
        instruction: CORRECTION_INSTRUCTION,
    });
}
