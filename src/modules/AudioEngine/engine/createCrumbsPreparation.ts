import { logger } from '#/infra/logger/appLogger';

import { getAudioDeviceRuntimeSink } from './audioDeviceRuntimeSink';

import type { DeviceContentLoadOutcome } from './deviceReadinessDiagnostics';

async function prepareLiveCrumbsDevice(
    input: Parameters<ReturnType<typeof getAudioDeviceRuntimeSink>['prepareCrumbsDevice']>[0],
    deviceType: string
): Promise<DeviceContentLoadOutcome> {
    try {
        return await getAudioDeviceRuntimeSink().prepareCrumbsDevice(input);
    } catch (error) {
        logger.warn(`[WebAudioEngine] ${deviceType} sample preparation failed: ${String(error)}`);
        return 'failed';
    }
}

export function createCrumbsPreparation(deviceId: string, deviceType: string, port: MessagePort, signal?: AbortSignal) {
    let preparation: Promise<DeviceContentLoadOutcome> | undefined;
    let preparationAbort: AbortController | undefined;
    let disposed = false;
    let pendingRefresh = false;
    const prepare = (sampleOnly: boolean): Promise<DeviceContentLoadOutcome> => {
        preparationAbort?.abort();
        preparationAbort = new AbortController();
        let preparationSignal = preparationAbort.signal;
        if (signal) {
            preparationSignal = AbortSignal.any([signal, preparationSignal]);
        }
        const input: Parameters<ReturnType<typeof getAudioDeviceRuntimeSink>['prepareCrumbsDevice']>[0] = {
            deviceId,
            port,
            signal: preparationSignal,
        };
        if (sampleOnly) {
            input.sampleOnly = true;
        }
        preparation = prepareLiveCrumbsDevice(input, deviceType);
        return preparation;
    };
    return {
        refresh(): void {
            if (disposed || signal?.aborted) {
                return;
            }
            if (!preparation) {
                pendingRefresh = true;
                return;
            }
            void prepare(true);
        },
        async start(): Promise<DeviceContentLoadOutcome> {
            let current = prepare(false);
            if (pendingRefresh) {
                current = prepare(true);
            }
            let outcome = await current;
            while (preparation && current !== preparation) {
                current = preparation;
                outcome = await current;
            }
            return outcome;
        },
        dispose(): void {
            disposed = true;
            preparationAbort?.abort();
        },
    };
}
