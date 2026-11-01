import { type AnswerEvidenceEntry, type AnswerSuggestion } from '../models/PlanningOutcome';

export const HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY = 'Hosted AI privacy disclosure';

/**
 * An answer the Prompt Bar shows, kept whole so the user can open it in the chat. It names the
 * project and the revision it answered about: the notice outlives both, so opening it must prove
 * they are still the ones the user is looking at. A suggestion the answer offers rides along and
 * reaches the chat only through that same proof.
 */
export type AiAnswerNotice = {
    prompt: string;
    text: string;
    evidence: readonly AnswerEvidenceEntry[];
    suggestion?: AnswerSuggestion;
    projectIdentity: string;
    projectRevision: string;
};

type AiChangeNotificationFields = {
    id: string;
    summary: string;
    details: string[];
    timestamp: number;
};

export type AiChangeNotification =
    | (AiChangeNotificationFields & { kind: 'applied-change' | 'notice' })
    | (AiChangeNotificationFields & { kind: 'answer'; answer: AiAnswerNotice });

export type AiChangeNotificationListener = (change: AiChangeNotification) => void;

// Shared by notifyAiChange() and subscribeAiChangeNotification(); not exported from
// the AiRuntime use-case contract barrel.
export const aiChangeNotificationListeners = new Set<AiChangeNotificationListener>();
