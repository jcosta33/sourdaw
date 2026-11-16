import { type ClipLifecycleKind, clipLifecycleKindByActionType } from '../models/ClipLifecycleKindByActionType';
import { type RuntimeAction } from '../models/RuntimeAction';

/** How an action treats the clips it names; an action type the record does not own leaves them in place. */
export function getClipLifecycleKind(action: RuntimeAction): ClipLifecycleKind {
    if (!Object.hasOwn(clipLifecycleKindByActionType, action.type)) {
        return 'none';
    }
    return clipLifecycleKindByActionType[action.type];
}
