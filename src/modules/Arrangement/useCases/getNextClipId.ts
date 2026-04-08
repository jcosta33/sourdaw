import { inject } from '#/infra/di/inject';
import { getNextClipId as allocateClipIdFromCounter } from '../repositories/clipIdCounter';

/**
 * Allocate a new unique clip ID.
 *
 * Public use-case surface over Arrangement's private clip-id counter. The
 * signature `() => string` is the cross-module contract; the underlying
 * counter representation is an internal detail.
 */
export const getNextClipId = inject({ allocateClipIdFromCounter })(
    ({ allocateClipIdFromCounter }) =>
        function getNextClipId(): string {
            return allocateClipIdFromCounter();
        }
);
