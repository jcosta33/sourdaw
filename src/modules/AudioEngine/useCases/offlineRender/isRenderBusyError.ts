import { isAppError } from '#/infra/errors/isAppError';

import { type RenderBusyError } from '../../errors/RenderBusyError';

/** Whether a render stopped because another render holds the lock, or a musician's export took it from an agent render. */
export function isRenderBusyError(error: unknown): error is RenderBusyError {
    return isAppError(error) && error._tag === 'RenderBusy';
}
