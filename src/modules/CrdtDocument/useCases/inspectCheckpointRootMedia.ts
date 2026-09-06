import { automergeRepository } from '../repositories/automergeRepository';

export function inspectCheckpointRootMedia(
    input: Parameters<typeof automergeRepository.inspectCheckpointRootMedia>[0]
): ReturnType<typeof automergeRepository.inspectCheckpointRootMedia> {
    return automergeRepository.inspectCheckpointRootMedia(input);
}
