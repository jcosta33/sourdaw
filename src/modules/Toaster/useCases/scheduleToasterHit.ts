import { getAudioSampleRate, getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

type ScheduleToasterHitInput = {
    deviceId: string;
    padIndex: number;
    velocity: number;
    targetTimeSeconds: number;
    padParams?: Array<{ name: string; value: number }>;
    restoreEngineType?: number;
    fillCondition?: 'fill' | 'not-fill';
};

export function scheduleToasterHit({
    deviceId,
    padIndex,
    velocity,
    targetTimeSeconds,
    padParams = [],
    restoreEngineType,
    fillCondition,
}: ScheduleToasterHitInput): void {
    const controls = getToasterDeviceControls(deviceId);
    if (!controls?.ready) {
        return;
    }

    const sampleFrame = Math.max(0, Math.round(targetTimeSeconds * getAudioSampleRate()));
    controls.scheduleHit({
        pad: padIndex,
        velocity,
        sampleFrame,
        padParams,
        restoreEngineType,
        fillCondition,
    });
}
