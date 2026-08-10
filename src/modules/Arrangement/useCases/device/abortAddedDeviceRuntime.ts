import { removeDeviceFromStrip } from '#/modules/AudioEngine/useCases';

type AbortAddedDeviceRuntimeInput = {
    trackId: string;
    deviceId: string;
};

export function abortAddedDeviceRuntime({ trackId, deviceId }: AbortAddedDeviceRuntimeInput): void {
    try {
        removeDeviceFromStrip(trackId, deviceId);
    } catch (error) {
        throw new Error(
            `Runtime cleanup could not remove device ${deviceId} from track ${trackId}: ${String(error)}; manual repair is required`,
            { cause: error }
        );
    }
}
