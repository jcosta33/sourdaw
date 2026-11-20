import { type Device } from '#/modules/Arrangement/stores';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { valuesEqual } from '#/utils/structuralEquality';

import { type BacteriaFactoryPatchAction } from '../../events/bacteriaAppActions';

type Payload = BacteriaFactoryPatchAction['payload'];
type PendingPublication = { payload: Payload; identity: string };

const pending = new Map<string, PendingPublication>();

function hold(payload: Payload): void {
    pending.set(payload.deviceId, { payload, identity: captureProjectIdentity() });
}

function release(payload: Payload): void {
    if (pending.get(payload.deviceId)?.payload === payload) {
        pending.delete(payload.deviceId);
    }
}

function matches(device: Device): boolean {
    const publication = pending.get(device.id);
    if (!publication || publication.identity !== captureProjectIdentity()) {
        return false;
    }
    const { after } = publication.payload;
    return (
        valuesEqual(after.deviceState, device.deviceState ?? null) &&
        Object.entries(after.parameterValues).every(([key, value]) => (device.parameterValues[key] ?? null) === value)
    );
}

export const bacteriaFactoryPatchPublication = { hold, release, matches };
