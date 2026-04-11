/**
 * Use case: resolve synth params for a track by reading the live track store.
 *
 * Moved here from Synth/useCases/builtinSynth to break a circular module
 * dependency: builtinSynth → Arrangement/useCases → AudioEngine/useCases →
 * audition → Synth → builtinSynth (TDZ on getTrackById).
 *
 * Valid for live-engine consumers (transport, mixer, live preview) that always
 * want the current store value. For offline rendering, prefer
 * `getSynthParamsFromDevices(track.devices)` to use a stable snapshot and
 * avoid a live-store read mid-render.
 */

import { inject } from '#/infra/di/inject';
import { getTrackById } from './getTrackById';
import { defaultSynthParams, type SynthParams } from '#/modules/AudioEngine/useCases';
import { getSynthParamsFromDevices } from '#/modules/Synth/useCases';

export const getSynthParamsForTrack = inject({ getTrackById })(({ getTrackById }) => {
    return function getSynthParamsForTrack(trackId: string): SynthParams {
        const track = getTrackById(trackId);
        if (!track) {
            return { ...defaultSynthParams };
        }
        return getSynthParamsFromDevices(track.devices);
    };
});
