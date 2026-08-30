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

/** What a session with nothing to play — or no clock to place it on — holds. */
const NO_PROGRAMME: LiveGraphProgramme = {
    playbacksByStripId: new Map(),
    bakedStripIds: new Set(),
    exclusions: [],
};

export type ReadLiveGraphProgrammeInput = Readonly<{
    /** The strips this session builds, in project order. */
    stripTracks: LiveGraphProgrammeInput['stripTracks'];
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
        return NO_PROGRAMME;
    }
    return projectLiveGraphProgramme({
        stripTracks: input.stripTracks,
        sampleRate: input.sampleRate,
        defaultTempo: transportStore.value?.tempo ?? 120,
        changes: tempoMapStore.value?.changes ?? [],
        projectPpqEndpoints: project,
        resolveTempoAtBeat,
        readBuffer: (bufferId) => audioBufferCache.get(bufferId),
        compensationDelaySeconds: getCompensationDelay,
    });
}
