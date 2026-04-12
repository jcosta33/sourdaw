import { inject } from '#/infra/di/inject';
import { type BacteriaPatch } from '../../models/BacteriaPatch';
import { loadBacteriaPatch } from '../../stores/bacteriaStore';
import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';
import type { DeviceRef, PersistDeviceParamFn, UpdateDeviceParamFn } from './helpers';
import { createFindDeviceRef, encodePatchValue } from './helpers';

function createPushParamImmediately(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

export const loadBacteriaPatchWithAudio = inject(bacteriaParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const pushParamImmediately = createPushParamImmediately(updateDeviceParamFn, persistDeviceParamFn);
        return function loadBacteriaPatchWithAudio(deviceId: string, patch: BacteriaPatch): void {
            loadBacteriaPatch(deviceId, patch);

            const ref = findDeviceRef(deviceId);
            if (!ref) {return;}

            const globalParams: Array<[string, unknown]> = [
        ['mix', patch.mix],
        ['outputGain', patch.outputGain],
        ['inputGain', patch.inputGain],
        ['bypass', patch.bypass],
        ['crossoverMode', patch.crossoverMode],
        ['bandCount', patch.bandCount],
        ['crossoverFreq1', patch.crossoverFreq1],
        ['crossoverFreq2', patch.crossoverFreq2],
        ['crossoverFreq3', patch.crossoverFreq3],
        ['crossoverFreq4', patch.crossoverFreq4],
        ['crossoverFreq5', patch.crossoverFreq5],
        ['crossoverSlope', patch.crossoverSlope],
        ['globalRouting', patch.globalRouting],
        ['macro1', patch.macro1],
        ['macro2', patch.macro2],
        ['macro3', patch.macro3],
        ['macro4', patch.macro4],
        ['macro5', patch.macro5],
        ['macro6', patch.macro6],
        ['macro7', patch.macro7],
        ['macro8', patch.macro8],
        ['morphX', patch.morphX],
        ['morphY', patch.morphY],
        ['lfo1Rate', patch.lfo1Rate],
        ['lfo1Shape', patch.lfo1Shape],
        ['lfo1Amount', patch.lfo1Amount],
        ['lfo2Rate', patch.lfo2Rate],
        ['lfo2Shape', patch.lfo2Shape],
        ['lfo2Amount', patch.lfo2Amount],
        ['envFollowerAttack', patch.envFollowerAttack],
        ['envFollowerRelease', patch.envFollowerRelease],
        ['stepSeqSteps', patch.stepSeqSteps],
        ['stepSeqRate', patch.stepSeqRate],
        ['lorenzSigma', patch.lorenzSigma],
        ['lorenzRho', patch.lorenzRho],
        ['lorenzBeta', patch.lorenzBeta],
        ['lorenzSpeed', patch.lorenzSpeed],
    ];

    for (const [key, rawValue] of globalParams) {
        const encodedValue = encodePatchValue(key, rawValue);
        if (encodedValue !== null) {
            pushParamImmediately(ref, key, encodedValue);
        }
    }

            patch.bands.forEach((band, bandIndex) => {
                const bandParams: Array<[string, unknown]> = [
                    ['enabled', band.enabled],
                    ['solo', band.solo],
                    ['mute', band.mute],
                    ['gain', band.gain],
                    ['oversampling', band.oversampling],
                    ['distortionEnabled', band.distortionEnabled],
                    ['filterEnabled', band.filterEnabled],
                    ['granularEnabled', band.granularEnabled],
                    ['spectralEnabled', band.spectralEnabled],
                    ['modulationEnabled', band.modulationEnabled],
                    ['convolutionEnabled', band.convolutionEnabled],
                    ['freqShiftEnabled', band.freqShiftEnabled],
                    ['chorusEnabled', band.chorusEnabled],
                    ['phaserEnabled', band.phaserEnabled],
                    ['lofiEnabled', band.lofiEnabled],
                    ['distortionMode', band.distortionMode],
                    ['drive', band.drive],
                    ['asymmetry', band.asymmetry],
                    ['foldbackThreshold', band.foldbackThreshold],
                    ['bitDepth', band.bitDepth],
                    ['sampleRateReduce', band.sampleRateReduce],
                    ['tubeBias', band.tubeBias],
                    ['breakdownDepth', band.breakdownDepth],
                    ['filterMode', band.filterMode],
                    ['filterCutoff', band.filterCutoff],
                    ['filterResonance', band.filterResonance],
                    ['filterEnvAmount', band.filterEnvAmount],
                    ['filterEnvAttack', band.filterEnvAttack],
                    ['filterEnvRelease', band.filterEnvRelease],
                    ['chorusRate', band.chorusRate],
                    ['chorusDepth', band.chorusDepth],
                    ['chorusFeedback', band.chorusFeedback],
                    ['chorusMix', band.chorusMix],
                    ['phaserRate', band.phaserRate],
                    ['phaserDepth', band.phaserDepth],
                    ['phaserFeedback', band.phaserFeedback],
                    ['phaserMix', band.phaserMix],
                    ['grainSize', band.grainSize],
                    ['grainDensity', band.grainDensity],
                    ['grainPosOffset', band.grainPosOffset],
                    ['grainPitch', band.grainPitch],
                    ['grainWindow', band.grainWindow],
                    ['grainFreeze', band.grainFreeze],
                    ['grainMix', band.grainMix],
                    ['spectralBlur', band.spectralBlur],
                    ['spectralFreeze', band.spectralFreeze],
                    ['spectralMix', band.spectralMix],
                    ['freqShiftHz', band.freqShiftHz],
                    ['freqShiftMix', band.freqShiftMix],
                    ['lofiAmount', band.lofiAmount],
                    ['codecArtifact', band.codecArtifact],
                    ['convolutionMix', band.convolutionMix],
                    ['convolutionSeparation', band.convolutionSeparation],
                    ['routingMode', band.routingMode],
                ];

                for (const [key, rawValue] of bandParams) {
                    const encodedValue = encodePatchValue(key, rawValue);
                    if (encodedValue !== null) {
                        pushParamImmediately(ref, `band${bandIndex}_${key}`, encodedValue);
                    }
                }
            });
        };
    }
);