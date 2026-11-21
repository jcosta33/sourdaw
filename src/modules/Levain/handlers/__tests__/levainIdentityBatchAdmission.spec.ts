import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type SetLevainIdentityAction } from '../../events/levainAppActions';
import { admitsLevainIdentityBatch } from '../levainIdentityBatchAdmission';

const snapshot = { deviceState: null, parameterValues: {} };
const identity: SetLevainIdentityAction = {
    type: 'setLevainIdentity',
    payload: {
        kind: 'instrument',
        deviceId: 'levain',
        trackId: 'track-1',
        deviceIds: ['levain'],
        label: 'Load instrument',
        before: snapshot,
        after: snapshot,
        missingDeviceState: { version: 1, data: {} },
    },
};

function admits(sibling: AppAction) {
    return admitsLevainIdentityBatch(identity, { actions: [identity, sibling], actionIndex: 0 });
}

describe('admitsLevainIdentityBatch', () => {
    it('refuses a sibling that changes the same track outside the plan', () => {
        expect(admits({ type: 'removeTrack', payload: { trackId: 'track-1' } })).toBe(false);
    });

    it('admits the same sibling kind on another track and an unrelated sibling on the same track', () => {
        expect(admits({ type: 'removeTrack', payload: { trackId: 'track-2' } })).toBe(true);
        expect(admits({ type: 'selectTrack', payload: { trackId: 'track-1' } })).toBe(true);
    });
});
