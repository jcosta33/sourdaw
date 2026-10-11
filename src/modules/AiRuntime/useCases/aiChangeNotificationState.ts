import { type AnswerEvidenceEntry } from '../models/PlanningOutcome';

export const HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY = 'Hosted AI privacy disclosure';

/** An answer the Prompt Bar shows, kept whole so the user can open it in the chat. */
export type AiAnswerNotice = { prompt: string; text: string; evidence: readonly AnswerEvidenceEntry[] };

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
