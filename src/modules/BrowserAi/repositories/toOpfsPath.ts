import { type ModelPath } from './storageTypes';

export function toOpfsPath({ family, modelId }: ModelPath): string {
    return `${family}/${modelId}`;
}
