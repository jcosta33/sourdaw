import { executeUserAppAction } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

export function executeCommandAction(
    onCommitted: (() => void) | undefined,
    action: AppAction,
    options?: Parameters<typeof executeUserAppAction>[1]
): Promise<void> {
    if (!onCommitted) {
        return options === undefined ? executeUserAppAction(action) : executeUserAppAction(action, options);
    }
    return executeUserAppAction(action, { ...options, onCommitted });
}
