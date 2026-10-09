import {
    ANSWER_RESPOND_MAX_CALL_ID_LENGTH,
    ANSWER_RESPOND_MAX_EVIDENCE_CALL_IDS,
    ANSWER_RESPOND_MAX_TEXT_LENGTH,
    type AnswerRespondArguments,
} from '../models/AnswerRespond';

type ParsedAnswerRespond =
    { status: 'accepted'; answer: AnswerRespondArguments } | { status: 'rejected'; reason: string };

function isCallId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= ANSWER_RESPOND_MAX_CALL_ID_LENGTH;
}

/**
 * The single reader of an answer call's arguments. Text that is empty once trimmed is refused, so no
 * surface ever shows an answer with nothing in it; repeated call ids collapse to one, so the evidence
 * a run cites never lists the same receipt twice.
 */
export function parseAnswerRespond(args: Readonly<Record<string, unknown>>): ParsedAnswerRespond {
    if (Object.keys(args).some((key) => key !== 'text' && key !== 'evidenceCallIds')) {
        return { status: 'rejected', reason: 'Provider answer carries an argument outside the catalog contract.' };
    }
    const text = args.text;
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > ANSWER_RESPOND_MAX_TEXT_LENGTH) {
        return {
            status: 'rejected',
            reason: `Provider answer field text must be non-empty text of at most ${String(ANSWER_RESPOND_MAX_TEXT_LENGTH)} characters.`,
        };
    }
    const evidenceCallIds = args.evidenceCallIds;
    if (
        !Array.isArray(evidenceCallIds) ||
        evidenceCallIds.length > ANSWER_RESPOND_MAX_EVIDENCE_CALL_IDS ||
        !evidenceCallIds.every(isCallId)
    ) {
        return {
            status: 'rejected',
            reason: `Provider answer field evidenceCallIds must hold at most ${String(ANSWER_RESPOND_MAX_EVIDENCE_CALL_IDS)} call ids.`,
        };
    }
    return { status: 'accepted', answer: { text, evidenceCallIds: [...new Set(evidenceCallIds)] } };
}
