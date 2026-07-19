import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { runCommandMutationExclusive } from './commandMutation';
import { executeAppActionImpl } from './executeAppActionImpl';

export function executeAppAction(action: AppAction, options?: ExecuteOptions): Promise<void> {
    return runCommandMutationExclusive(() => executeAppActionImpl(action, options));
}
