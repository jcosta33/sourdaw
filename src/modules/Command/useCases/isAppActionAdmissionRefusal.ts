import { AppActionAdmissionRefusedError } from '../errors/AppActionExecutionError';

/** True when the dispatch gate refused the action; a handler's own conflict is not a refusal. */
export function isAppActionAdmissionRefusal(error: unknown): error is AppActionAdmissionRefusedError {
    return error instanceof AppActionAdmissionRefusedError;
}
