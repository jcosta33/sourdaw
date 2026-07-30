import { subscribeDeviceTelemetryDemand } from '../../engine/telemetry/deviceTelemetryScheduler';

type SubscribeDeviceTelemetryInput = {
    deviceId: string;
};

export function subscribeDeviceTelemetry(input: SubscribeDeviceTelemetryInput): () => void {
    return subscribeDeviceTelemetryDemand(input);
}
