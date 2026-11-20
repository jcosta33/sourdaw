import { type ArticulationType } from '../models/LevainPatch';

import { commitLevainIdentity } from './commitLevainIdentity';

/** Change the articulation of the instrument this device currently owns. */
export function selectLevainArticulation(deviceId: string, articulation: ArticulationType): Promise<void> {
    return commitLevainIdentity(deviceId, { kind: 'articulation', articulation });
}
