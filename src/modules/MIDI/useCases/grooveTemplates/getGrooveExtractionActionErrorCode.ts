import {
    GROOVE_EXTRACTION_ACTION_ERROR_CODES,
    isGrooveExtractionActionError,
    type GrooveExtractionActionErrorCode,
} from '../../errors/GrooveExtractionActionError';

function isGrooveExtractionActionErrorCode(value: unknown): value is GrooveExtractionActionErrorCode {
    return GROOVE_EXTRACTION_ACTION_ERROR_CODES.some((code) => code === value);
}

/**
 * The extraction's refusal code, read from what the refusal carried: the error thrown for a request
 * no project state could satisfy, or the conflict reason the handler returned when the project moved
 * under the extraction (its clip notes changed since it was pinned, or its template id now holds
 * other content). The caller that executed the action unwraps the conflict error into its reason.
 */
export function getGrooveExtractionActionErrorCode(refusal: unknown): GrooveExtractionActionErrorCode | null {
    if (isGrooveExtractionActionError(refusal)) {
        return refusal.code;
    }
    return isGrooveExtractionActionErrorCode(refusal) ? refusal : null;
}
