import { type AnswerEvidenceEntry } from './PlanningOutcome';

export const ANSWER_RESPOND_MAX_TEXT_LENGTH = 4096;
/** A run holds at most a few dozen calls, so this bounds the list without ever cutting a real one short. */
export const ANSWER_RESPOND_MAX_EVIDENCE_CALL_IDS = 32;
export const ANSWER_RESPOND_MAX_CALL_ID_LENGTH = 256;

/** What a provider's `answer.respond` call declared, before its evidence is resolved against the run. */
export type AnswerRespondArguments = {
    text: string;
    /** The cited call ids, each once, in the order the provider first named them. */
    evidenceCallIds: string[];
};

/** A run's answer: the text, and the receipts of this run it rests on. */
export type PlanningAnswer = { text: string; evidence: AnswerEvidenceEntry[] };
