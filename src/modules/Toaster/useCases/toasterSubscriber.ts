import { eventBus, logger } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { toasterStore } from '../stores/toasterStore';
import { TOASTER_ENGINE_MAP } from '../useCases/loadToasterKit';

type DeviceNodeRef = {
    deviceId: string;
    toasterControls?: {
        setParam: (n: string, v: number) => void;
        setPadParam: (pad: number, n: string, v: number) => void;
    };
};

export const initToasterSubscribers = inject({ eventBus, logger })(
    ({ eventBus, logger }) =>
        function initToasterSubscribers(): () => void {
            const unsubscribe = eventBus.on('audioDevice.loaded', (payload) => {
                if (payload.deviceType !== 'toaster') {
                    return;
                }

                logger.info('Hydrating newly loaded Toaster WASM engine with store state');

                const kit = toasterStore.value?.kit;
                const deviceId = payload.deviceId;

                if (!kit) {
                    return;
                }

                let foundStrip;
                for (const track of getAllTracks()) {
                    if (track.devices.some((d) => d.id === deviceId)) {
                        foundStrip = getTrackStrip(track.id);
                        break;
                    }
                }

                const dn = foundStrip?.deviceNodes.find((d: DeviceNodeRef) => d.deviceId === deviceId);
                const tControls = dn?.toasterControls;

                if (!tControls) {
                    return;
                }

                tControls.setParam('master_gain', kit.masterGain);
                tControls.setParam('reverb_mix', kit.reverbMix);
                tControls.setParam('reverb_decay', kit.reverbDecay);
                tControls.setParam('delay_time', kit.delayTime);
                tControls.setParam('delay_feedback', kit.delayFeedback);
                tControls.setParam('delay_mix', kit.delayMix);
                tControls.setParam('lofi_bits', kit.lofiBits);
                tControls.setParam('lofi_rate', kit.lofiRate);
                tControls.setParam('lofi_mix', kit.lofiMix);

                for (let i = 0; i < kit.pads.length; i++) {
                    const pad = kit.pads[i]!;
                    const engineIdx = TOASTER_ENGINE_MAP[pad.engineType] ?? 0;
                    tControls.setPadParam(i, 'engine_type', engineIdx);

                    if (pad.engineType === 'hihat-open') {
                        tControls.setPadParam(i, 'open', 1);
                    }
                    if (pad.engineType === 'hihat-closed') {
                        tControls.setPadParam(i, 'open', 0);
                    }

                    tControls.setPadParam(i, 'volume', pad.volume);
                    tControls.setPadParam(i, 'pan', pad.pan);
                    tControls.setPadParam(i, 'tune', pad.tune);
                    tControls.setPadParam(i, 'decay', pad.decay);
                    tControls.setPadParam(i, 'tone', pad.tone);
                    tControls.setPadParam(i, 'drive', pad.drive);
                    tControls.setPadParam(i, 'filter_cutoff', pad.filterCutoff);
                    tControls.setPadParam(i, 'filter_resonance', pad.filterResonance);
                    tControls.setPadParam(i, 'send_reverb', pad.sendReverb);
                    tControls.setPadParam(i, 'send_delay', pad.sendDelay);
                }
            });

            return unsubscribe;
        }
);
