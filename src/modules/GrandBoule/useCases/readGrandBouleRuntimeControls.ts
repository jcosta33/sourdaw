import { getTrackStrip } from '#/modules/AudioEngine/useCases';

export type GrandBouleRuntimeControls = NonNullable<
    NonNullable<ReturnType<typeof getTrackStrip>>['deviceNodes'][number]['grandBouleControls']
>;

export function readGrandBouleRuntimeControls(
    trackId: string | undefined,
    deviceId: string
): GrandBouleRuntimeControls | null {
    if (trackId === undefined) {
        return null;
    }
    return (
        getTrackStrip(trackId)?.deviceNodes.find((node) => node.deviceId === deviceId && node.grandBouleControls?.ready)
            ?.grandBouleControls ?? null
    );
}
