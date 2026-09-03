import {
    COMMAND_BATCH_DECLINE_KINDS,
    COMMAND_BATCH_DECLINE_MAX_QUESTION_LENGTH,
    COMMAND_BATCH_DECLINE_MAX_QUESTIONS,
    COMMAND_BATCH_DECLINE_MAX_REASON_LENGTH,
    type CommandBatchDecline,
} from '../models/CommandBatchDecline';

type ParsedCommandBatchDecline =
    { status: 'accepted'; decline: CommandBatchDecline } | { status: 'rejected'; reason: string };

function isDeclineKind(value: unknown): value is CommandBatchDecline['kind'] {
    return COMMAND_BATCH_DECLINE_KINDS.some((kind) => kind === value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * The single reader of a decline call's arguments, so the loop that admits the turn and the planner
 * that classifies its outcome cannot disagree about what the provider actually declared.
 */
export function parseCommandBatchDecline(args: Readonly<Record<string, unknown>>): ParsedCommandBatchDecline {
    if (Object.keys(args).some((key) => key !== 'kind' && key !== 'reason' && key !== 'questions')) {
        return { status: 'rejected', reason: 'Provider decline carries an argument outside the catalog contract.' };
    }
    if (!isDeclineKind(args.kind)) {
        return { status: 'rejected', reason: 'Provider decline field kind must be clarify or unsupported.' };
    }
    if (!isBoundedText(args.reason, COMMAND_BATCH_DECLINE_MAX_REASON_LENGTH)) {
        return {
            status: 'rejected',
            reason: `Provider decline field reason must be text of at most ${String(COMMAND_BATCH_DECLINE_MAX_REASON_LENGTH)} characters.`,
        };
    }
    const questions = args.questions;
    if (
        !Array.isArray(questions) ||
        questions.length > COMMAND_BATCH_DECLINE_MAX_QUESTIONS ||
        !questions.every((question) => isBoundedText(question, COMMAND_BATCH_DECLINE_MAX_QUESTION_LENGTH))
    ) {
        return {
            status: 'rejected',
            reason: `Provider decline field questions must hold at most ${String(COMMAND_BATCH_DECLINE_MAX_QUESTIONS)} bounded questions.`,
        };
    }
    return { status: 'accepted', decline: { kind: args.kind, reason: args.reason, questions: [...questions] } };
}
