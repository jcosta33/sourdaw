import { AppActionCommittedError } from '../errors/AppActionExecutionError';

type CreateAppActionCommittedErrorInput = {
    actionType: string;
    cause: unknown;
};

export function createAppActionCommittedError({ actionType, cause }: CreateAppActionCommittedErrorInput): Error {
    return new AppActionCommittedError(actionType, cause);
}
