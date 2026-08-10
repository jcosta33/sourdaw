import { executeAppAction } from '#/modules/Command/useCases';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { validateActions } from '../validateActions';

export async function runAppAction(action: RuntimeAction): Promise<void> {
    const [validated_action] = validateActions([action]);
    if (!validated_action) {
        return;
    }

    const materialized = materializeActionStateGuards([validated_action], getProjectContext());
    if (materialized.status === 'rejected') {
        return;
    }

    await executeAppAction(materialized.actions[0]!);
}
