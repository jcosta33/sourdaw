import { isGrooveExtractionActionError } from '../../errors/GrooveExtractionActionError';

export function getGrooveExtractionActionErrorCode(error: unknown) {
    return isGrooveExtractionActionError(error) ? error.code : null;
}
