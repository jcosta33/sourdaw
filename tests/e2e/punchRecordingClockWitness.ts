import type { Page } from '@playwright/test';

import type { DiagnosticWindow } from './punchRecordingClockObserver';

export * from './punchRecordingClockObserver';

export async function bindPunchRecordingClockWitness(page: Page, trackId: string): Promise<void> {
    await page.evaluate(async (id) => {
        const audioModule: unknown = await import('/src/modules/AudioEngine/useCases/index.ts');
        const gestureModule: unknown = await import('/src/modules/Transport/stores/captureGestureBeat.ts');
        const playheadModule: unknown = await import('/src/modules/Transport/stores/playheadClockRef.ts');
        const wrapModule: unknown = await import('/src/modules/Transport/stores/playheadWrapCountRef.ts');
        const transportModule: unknown = await import('/src/modules/Transport/stores/transportStore.ts');
        if (
            typeof audioModule !== 'object' ||
            audioModule === null ||
            !('getAudioContext' in audioModule) ||
            typeof audioModule.getAudioContext !== 'function' ||
            !('getCompensationDelay' in audioModule) ||
            typeof audioModule.getCompensationDelay !== 'function' ||
            typeof gestureModule !== 'object' ||
            gestureModule === null ||
            !('captureGestureBeat' in gestureModule) ||
            typeof gestureModule.captureGestureBeat !== 'function' ||
            typeof playheadModule !== 'object' ||
            playheadModule === null ||
            !('playheadClockRef' in playheadModule) ||
            typeof wrapModule !== 'object' ||
            wrapModule === null ||
            !('playheadWrapCountRef' in wrapModule) ||
            typeof transportModule !== 'object' ||
            transportModule === null ||
            !('transportStore' in transportModule)
        ) {
            throw new TypeError('Punch clock source modules did not expose their expected contracts');
        }
        const captureGestureBeat = gestureModule.captureGestureBeat;
        const host = window as DiagnosticWindow;
        const state = host.__punchRecordingClockWitness;
        if (!state) {
            throw new Error('Punch recording clock witness was not installed');
        }
        const context: unknown = Reflect.apply(audioModule.getAudioContext, undefined, []);
        const compensation: unknown = Reflect.apply(audioModule.getCompensationDelay, undefined, [id]);
        if (!(context instanceof AudioContext) || typeof compensation !== 'number') {
            throw new TypeError('Punch recording admission did not expose a Web Audio clock and compensation');
        }
        state.admission = {
            baseLatencySeconds: context.baseLatency,
            outputLatencySeconds: context.outputLatency,
            trackCompensationSeconds: compensation,
        };
        state.admissionContext = context;
        state.readOutput = () => {
            const gestureBeat: unknown = Reflect.apply(captureGestureBeat, undefined, []);
            const playhead: unknown = playheadModule.playheadClockRef;
            const wraps: unknown = wrapModule.playheadWrapCountRef;
            const transport: unknown = transportModule.transportStore;
            if (
                typeof gestureBeat !== 'number' ||
                typeof playhead !== 'object' ||
                playhead === null ||
                !('beat' in playhead) ||
                typeof playhead.beat !== 'number' ||
                typeof wraps !== 'object' ||
                wraps === null ||
                !('current' in wraps) ||
                typeof wraps.current !== 'number' ||
                typeof transport !== 'object' ||
                transport === null ||
                !('value' in transport)
            ) {
                throw new TypeError('Punch transport clock witness is unavailable');
            }
            const transportValue: unknown = transport.value;
            return {
                gestureBeat,
                playheadBeat: playhead.beat,
                wrapCount: wraps.current,
                isRecording:
                    typeof transportValue === 'object' &&
                    transportValue !== null &&
                    'isRecording' in transportValue &&
                    transportValue.isRecording === true,
            };
        };
    }, trackId);
}
