export const COMMAND_BATCH_DECLINE_KINDS = ['clarify', 'unsupported'] as const;
export const COMMAND_BATCH_DECLINE_MAX_QUESTIONS = 4;
export const COMMAND_BATCH_DECLINE_MAX_REASON_LENGTH = 512;
export const COMMAND_BATCH_DECLINE_MAX_QUESTION_LENGTH = 256;

/** A provider's declaration that a run produced no batch, and why. */
export type CommandBatchDecline = {
    kind: (typeof COMMAND_BATCH_DECLINE_KINDS)[number];
    reason: string;
    questions: string[];
};
