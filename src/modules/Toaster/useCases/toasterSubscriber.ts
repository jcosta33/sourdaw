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
                    if (track.devices.some((data) => data.id === deviceId)) {
                        foundStrip = getTrackStrip(track.id);
                        break;
                    }
                }

                const dn = foundStrip?.deviceNodes.find((data: DeviceNodeRef) => data.deviceId === deviceId);
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

                for (let index = 0; index < kit.pads.length; index++) {
                    const pad = kit.pads[index]!;
                    const engineIdx = TOASTER_ENGINE_MAP[pad.engineType] ?? 0;
                    tControls.setPadParam(index, 'engine_type', engineIdx);

                    if (pad.engineType === 'hihat-open') {
                        tControls.setPadParam(index, 'open', 1);
                    }
                    if (pad.engineType === 'hihat-closed') {
                        tControls.setPadParam(index, 'open', 0);
                    }

                    tControls.setPadParam(index, 'volume', pad.volume);
                    tControls.setPadParam(index, 'pan', pad.pan);
                    tControls.setPadParam(index, 'tune', pad.tune);
                    tControls.setPadParam(index, 'decay', pad.decay);
                    tControls.setPadParam(index, 'tone', pad.tone);
                    tControls.setPadParam(index, 'drive', pad.drive);
                    tControls.setPadParam(index, 'filter_cutoff', pad.filterCutoff);
                    tControls.setPadParam(index, 'filter_resonance', pad.filterResonance);
                    tControls.setPadParam(index, 'send_reverb', pad.sendReverb);
                    tControls.setPadParam(index, 'send_delay', pad.sendDelay);
                }
            });

            return unsubscribe;
        }
);
