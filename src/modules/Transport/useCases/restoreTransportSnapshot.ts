import { logger } from '#/infra/logger/appLogger';
import {
    hasLiveNativeGraphSession,
    repositionNativeLiveGraphSession,
    setMasterGainValue,
    stopNativeLiveGraphSession,
    updateNativeLiveGraphSessionTransportMaps,
} from '#/modules/AudioEngine/useCases';

import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { sanitize_transport_snapshot, transportStore } from '../stores/transportStore';

import { secondsBetweenBeats } from './secondsBetweenBeats';
import { projectEngineTransportMaps } from './tempoMap/projectEngineTransportMaps';

export function restoreTransportSnapshot(snapshot: unknown): void {
    const wasPlaying = transportStore.value?.isPlaying === true;
    const restored = sanitize_transport_snapshot(snapshot);
    transportStore.set(restored);
    setMasterGainValue(restored.masterGain / 100);
    playheadPositionRef.current = restored.playheadPosition;

    if (!wasPlaying) {
        return;
    }
    if (!hasLiveNativeGraphSession()) {
        return;
    }

    const positionSeconds = secondsBetweenBeats(
        tempoMapStore.value?.changes ?? [],
        0,
        restored.playheadPosition,
        restored.tempo
    );

    Promise.resolve(updateNativeLiveGraphSessionTransportMaps({ transportMaps: projectEngineTransportMaps() })).catch(
        (error: unknown) => {
            logger.warn(
                new Error('Native live graph session failed to take restored transport maps', { cause: error })
            );
        }
    );
    Promise.resolve(repositionNativeLiveGraphSession({ positionSeconds })).catch((error: unknown) => {
        logger.warn(new Error('Native live graph session failed to reposition on restore', { cause: error }));
    });
    Promise.resolve(stopNativeLiveGraphSession({ positionSeconds })).catch((error: unknown) => {
        logger.warn(new Error('Native live graph session failed to park on restore', { cause: error }));
    });
}
