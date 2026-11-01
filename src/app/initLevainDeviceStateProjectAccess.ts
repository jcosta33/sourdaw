import { sanitizeTrackSnapshot } from '#/modules/Arrangement/stores';
import { DOC_PREFIX_ROOT, getCrdtDoc, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';
import { configureLevainDeviceStateProjectAccess } from '#/modules/Levain/useCases';

/** Observe every committed topology change, including losses hidden by batched projections. */
export function initLevainDeviceStateProjectAccess(): void {
    configureLevainDeviceStateProjectAccess({
        hasDevice: (ownerId, deviceId) => {
            const document = getCrdtDoc(DOC_PREFIX_ROOT);
            return (
                document !== undefined &&
                sanitizeTrackSnapshot(document.tracks)
                    .tracks.find((track) => track.id === ownerId)
                    ?.devices.some((device) => device.id === deviceId && device.type === 'levain') === true
            );
        },
        subscribe: (listener) =>
            subscribeToCrdtChanges((docId) => {
                if (docId === undefined || docId === DOC_PREFIX_ROOT) {
                    listener();
                }
            }),
    });
}
