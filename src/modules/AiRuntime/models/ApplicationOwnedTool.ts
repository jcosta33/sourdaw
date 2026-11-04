export const PROJECT_QUERY_TOOL_NAME = 'project.query';
export const APPLICATION_TOOL_RECEIPT_MAX_BYTES = 16_384;

type SettledReceiptIdentity = {
    callId: string;
    toolName: string;
    turn: number;
    receiptDigest: string;
};

/** Application bookkeeping for a held terminal, never acoustic proof or provider authority. */
export type TerminalMeasurementSettlement = {
    schemaVersion: 1;
    authorityId: string;
    revision: string;
    intake: SettledReceiptIdentity;
    deferredCalls: SettledReceiptIdentity[];
    measurement: SettledReceiptIdentity;
};

export type ApplicationToolReceipt = {
    schema: 'sourdaw.application-tool-receipt';
    schemaVersion: 1;
    callId: string;
    toolName: string;
    turn: number;
    /** Explicit application Re-preview reads use turn zero, independently of provider turns. */
    origin?: 'application-verification';
    status: 'success' | 'failure';
    revision: string | null;
    data: unknown;
    summary: string;
    warnings: string[];
    error: null | {
        code: string;
        safeMessage: string;
        retryable: boolean;
    };
};
