import { type AppAction } from '#/modules/Command/useCases/commandQueries';

export type IntentResult = {
    actions: AppAction[];
    confidence: number;
    rawText: string;
    requiresConfirmation: boolean;
};

export type AiRuntimeStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'error';
