import { isAppActionConflictError } from '#/modules/Command/useCases';

import {
    GROOVE_EXTRACTION_ACTION_ERROR_CODES,
    isGrooveExtractionActionError,
    type GrooveExtractionActionErrorCode,
} from '../../errors/GrooveExtractionActionError';

function isGrooveExtractionActionErrorCode(value: unknown): value is GrooveExtractionActionErrorCode {
    return GROOVE_EXTRACTION_ACTION_ERROR_CODES.some((code) => code === value);
}

/**
 * The extraction's refusal code: thrown for a request no project state could satisfy, or carried as
 * the conflict reason when the project moved under the extraction (its clip notes changed since it
 * was pinned, or its template id now holds other content).
 */
export function getGrooveExtractionActionErrorCode(error: unknown): GrooveExtractionActionErrorCode | null {
    if (isGrooveExtractionActionError(error)) {
        return error.code;
    }
    if (isAppActionConflictError(error) && isGrooveExtractionActionErrorCode(error.reason)) {
        return error.reason;
    }
    return null;
}
