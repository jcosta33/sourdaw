import { logger } from '#/infra/logger/appLogger';
import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { getEligibleDeviceParameterValues } from '#/modules/Arrangement/useCases';
import { type applyRuntimeGrinderPreset } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type GrinderFactoryPresetAction } from '../../events/grinderAppActions';
import { getGrinderState, replaceGrinderProjectParameters } from '../../stores/grinderStore';

import { buildRectifierHeavyPlayback } from './buildRectifierHeavyPlayback';
import { getRectifierHeavyPresetImage } from './getRectifierHeavyPresetImage';
import { paramBatcher } from './helpers';

type Payload = GrinderFactoryPresetAction['payload'];
type Dependencies = Readonly<{
    play: typeof applyRuntimeGrinderPreset;
    readEffectiveValue: Parameters<typeof buildRectifierHeavyPlayback>[2];
}>;

const latestPresetInstallations = new Map<string, object>();

function currentProjectValues(payload: Payload): Record<string, number> | null {
    const { trackId, deviceId } = payload;
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible' || target.trackId !== trackId) {
        return null;
    }
    const raw = trackStore.value?.tracks
        .find((track) => track.id === trackId)
        ?.devices.find((device) => device.id === deviceId)?.parameterValues;
    const captured = payload.direction === 'undo' ? payload.before : payload.after;
    if (
        !raw ||
        !Object.entries(captured).every(([key, value]) =>
            value === null ? !Object.hasOwn(raw, key) : Object.is(raw[key], value)
        )
    ) {
        return null;
    }
    return getEligibleDeviceParameterValues(deviceId);
}

export async function applyRectifierHeavyRuntime(
    payload: Payload,
    { play, readEffectiveValue }: Dependencies
): Promise<void> {
    const values = currentProjectValues(payload);
    if (!values) {
        return;
    }
    const { deviceId } = payload;
    const installation = {};
    latestPresetInstallations.set(deviceId, installation);
    try {
        const playback = buildRectifierHeavyPlayback(payload, values, readEffectiveValue);
        for (const { parameterId } of playback.web.parameters) {
            paramBatcher.cancel(`${deviceId}:${parameterId}`);
        }
        const previous = getGrinderState(deviceId);
        const name =
            payload.direction === 'undo' ? previous.basePatch.name : getRectifierHeavyPresetImage()?.patch.name;
        const installed = play(playback);
        replaceGrinderProjectParameters(deviceId, values, name);
        await installed;
    } catch (error) {
        if (latestPresetInstallations.get(deviceId) === installation && currentProjectValues(payload)) {
            logger.error(new Error('Could not synchronize the Grinder preset to live audio', { cause: error }));
            notifyUser('Grinder saved the preset change, but live audio could not confirm it.', 'warning');
        }
    } finally {
        if (latestPresetInstallations.get(deviceId) === installation) {
            latestPresetInstallations.delete(deviceId);
        }
    }
}
