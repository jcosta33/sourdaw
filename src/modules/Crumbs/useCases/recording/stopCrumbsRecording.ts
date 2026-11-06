import { stopRecording } from '../../repositories/crumbsBridge/stopRecording';
import {
    createCrumbsRecordingRequest,
    crumbsRecordingOwners,
    crumbsRecordingStore,
    isCrumbsRecordingTerminal,
    refreshCrumbsRecordingReadout,
    setCrumbsRecordingPhase,
} from '../../stores/crumbsRecordingStore';

export async function stopCrumbsRecording(instanceId: string): Promise<void> {
    const owner = crumbsRecordingOwners.get(instanceId);
    if (!owner?.active) {
        return;
    }
    let request = owner.request;
    if (!request) {
        const snapshot = owner.latest;
        if (!snapshot || isCrumbsRecordingTerminal(snapshot.phase)) {
            return;
        }
        request = createCrumbsRecordingRequest(Promise.resolve({ take_id: snapshot.take_id }));
        request.takeId = snapshot.take_id;
        owner.request = request;
    }
    if (request.stopPromise) {
        await request.stopPromise;
        return;
    }
    const stopping = request;
    stopping.stopRequested = true;
    refreshCrumbsRecordingReadout(instanceId, owner);
    stopping.stopPromise = (async () => {
        let accepted;
        try {
            accepted = await stopping.acceptance;
        } catch {
            // Arm refusal acquired nothing; its caller reports that failure.
            return;
        }
        if (
            !accepted ||
            stopping.stopSent ||
            (owner.latest?.take_id === accepted.take_id && isCrumbsRecordingTerminal(owner.latest.phase))
        ) {
            return;
        }
        stopping.stopSent = true;
        await stopRecording(instanceId, accepted.take_id);
    })();
    try {
        await stopping.stopPromise;
    } catch (error) {
        stopping.stopSent = false;
        stopping.stopRequested = false;
        stopping.stopPromise = null;
        if (
            !stopping.disposed &&
            owner.active &&
            crumbsRecordingOwners.get(instanceId) === owner &&
            owner.request === stopping
        ) {
            refreshCrumbsRecordingReadout(instanceId, owner);
            setCrumbsRecordingPhase(
                instanceId,
                crumbsRecordingStore.value?.[instanceId]?.phase ?? 'preparing',
                String(error)
            );
        }
        throw error;
    }
}
