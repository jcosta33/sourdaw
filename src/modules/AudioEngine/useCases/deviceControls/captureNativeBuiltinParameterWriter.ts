import { logger } from '#/infra/logger/appLogger';

import { isDeviceCarriedByNativeSession } from '../livePlayback/isDeviceCarriedByNativeSession';
import { nativeLiveGraphSession } from '../livePlayback/nativeLiveGraphSessionState';
import { readNativeChain } from '../livePlayback/readNativeChain';
import { sendNativeDeviceParameters } from '../livePlayback/sendNativeDeviceParameters';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';

type WriteParameters = (values: Readonly<Record<string, number>>) => void;

/** Capture the realized carrier so queued preview values cannot reach a replacement chain. */
export function captureNativeBuiltinParameterWriter(trackId: string, deviceId: string): WriteParameters | null {
    const { backend, rearmEpoch } = nativeLiveGraphSession;
    const chain = readNativeChain(trackId);
    if (!backend || !chain || !nativeBuiltinWriteTarget(trackId, deviceId)) {
        return null;
    }

    const isCurrent = (): boolean =>
        nativeLiveGraphSession.backend === backend &&
        nativeLiveGraphSession.rearmEpoch === rearmEpoch &&
        readNativeChain(trackId) === chain &&
        isDeviceCarriedByNativeSession(trackId, deviceId);

    return (values) => {
        if (isCurrent()) {
            void sendNativeDeviceParameters({ trackId, deviceId, values }, isCurrent).catch((error) => {
                logger.warn('[AudioEngine] Native built-in preview parameter write failed:', error);
            });
        }
    };
}
