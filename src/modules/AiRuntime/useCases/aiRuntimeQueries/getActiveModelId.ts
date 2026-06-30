import { getActiveModelId as readActiveModelId } from '../../repositories/webLlm/engineLifecycle';

export function getActiveModelId(): string {
    return readActiveModelId();
}
