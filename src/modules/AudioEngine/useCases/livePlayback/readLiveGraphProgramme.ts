/**
 * The live programme, read off project truth (#3068).
 *
 * `projectLiveGraphProgramme` is pure and takes its clock, its material and
 * its compensation as functions; this is the one place that binds them to the
 * stores. Both callers go through it — the play gesture, which needs the
 * commands, and the sample prime, which needs only the material they name —
 * so a prime can never register a different set of buffers from the one the
 * batch will play.
 *
 * The tempo projection comes from `offlinePpqEndpointProjectorState`, the
 * projector the composition root injects (`configureOfflinePpqEndpointProjection`
 * in `bootstrap.ts`). Its name says offline because the export needed it
 * first; what it holds is Transport's own beat arithmetic, which AudioEngine
 * may not import directly, and using the *same* injected law is what keeps the
 * live placement and the bounced placement on one grid. An unconfigured
 * projector answers no programme rather than a guessed one — the same refusal
 * `resolveRenderContext` leaves its callers to make.
 */

import { tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';

import {
    projectLiveGraphProgramme,
    type LiveGraphProgramme,
    type LiveGraphProgrammeInput,
} from './projectLiveGraphProgramme';
import { stripIdsHoldingLiveClips } from './stripIdsHoldingLiveClips';

/**
 * What a session with no clock to place its material on holds: no native
 * playback at all, and therefore every strip holding a live clip named as one
 * Web Audio alone voices. Leaving that set empty would tell the carrier law
 * those strips have nothing to sound, and it would gate them out of the only
 * carrier playing them.
 */
function noProgramme(stripTracks: LiveGraphProgrammeInput['stripTracks']): LiveGraphProgramme {
    return {
        playbacksByStripId: new Map(),
        bakedStripIds: new Set(),
        webVoicedStripIds: stripIdsHoldingLiveClips(stripTracks),
        exclusions: [],
    };
}

export type ReadLiveGraphProgrammeInput = Readonly<{
    /** The strips this session builds, in project order. */
    stripTracks: LiveGraphProgrammeInput['stripTracks'];
    /**
     * The external plugin instances the native engine currently owns.
     *
     * The caller's, not read here, for the same reason the topology takes it:
     * a session threads one attach state through every projection it makes, so
     * the programme and the topology cannot disagree about which instruments
     * the engine holds.
     */
    attachedInstanceIds: LiveGraphProgrammeInput['attachedInstanceIds'];
    /**
     * The frame grid every beat is placed on. The caller's, because the clock
     * a session is placed on belongs to whoever owns the transport — the same
     * reason `transportMaps` is passed in rather than read here.
     */
    sampleRate: number;
}>;

export function readLiveGraphProgramme(input: ReadLiveGraphProgrammeInput): LiveGraphProgramme {
    const { project, resolveTempoAtBeat } = offlinePpqEndpointProjectorState;
    if (!project || !resolveTempoAtBeat) {
        return noProgramme(input.stripTracks);
    }
    return projectLiveGraphProgramme({
        stripTracks: input.stripTracks,
        attachedInstanceIds: input.attachedInstanceIds,
        sampleRate: input.sampleRate,
        defaultTempo: transportStore.value?.tempo ?? 120,
        changes: tempoMapStore.value?.changes ?? [],
        projectPpqEndpoints: project,
        resolveTempoAtBeat,
        readBuffer: (bufferId) => audioBufferCache.get(bufferId),
        compensationDelaySeconds: getCompensationDelay,
    });
}
