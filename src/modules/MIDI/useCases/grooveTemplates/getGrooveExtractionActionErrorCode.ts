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
 * The extraction's refusal code: thrown for a refused extraction, or carried as the conflict reason
 * when a pinned extraction diverged from the clip's notes.
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
