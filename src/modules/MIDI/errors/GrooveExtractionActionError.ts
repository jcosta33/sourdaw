export const GROOVE_EXTRACTION_ACTION_ERROR_CODES = [
    'empty-source',
    'unsupported-subdivision',
    'invalid-source',
    'source-revision-mismatch',
    'proposal-mismatch',
    'template-identity-conflict',
] as const;

export type GrooveExtractionActionErrorCode = (typeof GROOVE_EXTRACTION_ACTION_ERROR_CODES)[number];

export class GrooveExtractionActionError extends Error {
    readonly code: GrooveExtractionActionErrorCode;

    constructor(code: GrooveExtractionActionErrorCode, message: string) {
        super(message);
        this.name = 'GrooveExtractionActionError';
        this.code = code;
    }
}

export function isGrooveExtractionActionError(error: unknown): error is GrooveExtractionActionError {
    return error instanceof GrooveExtractionActionError;
}
