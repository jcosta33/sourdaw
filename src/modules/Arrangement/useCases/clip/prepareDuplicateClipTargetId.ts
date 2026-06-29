import { getNextClipId } from '../../repositories/clipIdCounter';

export function prepareDuplicateClipTargetId(): string {
    return getNextClipId();
}
