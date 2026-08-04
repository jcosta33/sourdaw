import { getNextClipId } from '../../repositories/clipIdCounter';

export function getNextAppActionClipId(): string {
    return getNextClipId();
}
