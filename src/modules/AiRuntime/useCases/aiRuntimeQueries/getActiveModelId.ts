import { getActiveModelId as readActiveModelId } from '../../repositories/webLlm/getActiveModelId';

export function getActiveModelId(): string {
    return readActiveModelId();
}
