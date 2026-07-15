import { executeAppAction } from '#/modules/Command/useCases';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { validateActions } from '../validateActions';

export async function runAppAction(action: RuntimeAction): Promise<void> {
    const [validated_action] = validateActions([action]);
    if (!validated_action) {
        return;
    }

    await executeAppAction(validated_action);
}
