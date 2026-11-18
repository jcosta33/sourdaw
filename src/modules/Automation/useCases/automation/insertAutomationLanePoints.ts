import { getObjectId } from '@automerge/automerge';

import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectRootIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AutomationLane } from '../../models/Automation';
import { findRawAutomationLane } from '../../services/findRawAutomationLane';

type Insertion = Extract<AppAction, { type: 'insertAutomationLanePoints' }>['payload']['insertion'];
type LaneTarget = Pick<AutomationLane, 'id' | 'trackId' | 'parameterId' | 'clipId'>;

const pendingByRoot = new Map<string, Promise<void>>();

function readLaneObjectId(laneId: string) {
    const root = getCrdtDoc('root');
    const lane = root && findRawAutomationLane(root, laneId);
    return lane && getObjectId(lane);
}

/** Complete the preceding user edit before capturing the next lane's exact points. */
export async function insertAutomationLanePoints(lane: LaneTarget, insertion: Insertion): Promise<void> {
    const { id, trackId, parameterId, clipId } = lane;
    const owner: Omit<LaneTarget, 'id'> = { trackId, parameterId };
    if (clipId !== undefined) {
        owner.clipId = clipId;
    }
    const rootIdentity = captureProjectRootIdentity();
    const laneObjectId = readLaneObjectId(id);
    async function execute(): Promise<void> {
        await executeUserAppAction(
            {
                type: 'insertAutomationLanePoints',
                payload: { laneId: id, owner, insertion },
            },
            {
                authorizeFirstHandler: () =>
                    captureProjectRootIdentity() === rootIdentity && readLaneObjectId(id) === laneObjectId
                        ? null
                        : 'The automation lane changed while the insertion was waiting.',
            }
        );
    }

    const predecessor = pendingByRoot.get(rootIdentity);
    const insertionPending = predecessor ? predecessor.then(execute, execute) : execute();
    pendingByRoot.set(rootIdentity, insertionPending);
    try {
        await insertionPending;
    } finally {
        if (pendingByRoot.get(rootIdentity) === insertionPending) {
            pendingByRoot.delete(rootIdentity);
        }
    }
}
