export const PROJECT_QUERY_TOOL_NAME = 'project.query';

export type ApplicationToolReceipt = {
    schema: 'sourdaw.application-tool-receipt';
    schemaVersion: 1;
    callId: string;
    toolName: string;
    turn: number;
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
