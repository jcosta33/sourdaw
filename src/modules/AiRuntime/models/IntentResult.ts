import { type AppAction } from '#/modules/Command/useCases/commandQueries';

export type IntentResult = {
    actions: AppAction[];
    confidence: number;
    rawText: string;
    requiresConfirmation: boolean;
    /** Set when the JSON editor flow was used and changes were already applied */
    _jsonEditApplied?: boolean;
    /** Human-readable summaries of applied JSON edit changes */
    _jsonEditSummaries?: string[];
};
