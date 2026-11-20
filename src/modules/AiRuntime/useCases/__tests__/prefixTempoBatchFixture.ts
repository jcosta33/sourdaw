import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { createTrack } from '#/modules/Arrangement/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { getTransportHandlers, restoreTimelineMapSnapshot } from '#/modules/Transport/useCases';

import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { getProjectContext } from '../getProjectContext';

import { configureMetricGoalProject } from './metricGoalWorkflowFixture';

/** The live project's tempo map: 60 BPM from the start, so its mixdown walks every span at 60 BPM. */
export const LIVE_TEMPO_MAP = [
    { id: 'live-start', beat: 0, tempo: 60, curve: 'instant' as const },
    { id: 'live-slow', beat: 10, tempo: 60, curve: 'instant' as const },
];
/** What the prefix batch's `setTempo` leaves in the prefix document: the event at the playhead rewritten. */
export const PREFIX_TEMPO_MAP = [
    { id: 'live-start', beat: 0, tempo: 120, curve: 'instant' as const },
    { id: 'live-slow', beat: 10, tempo: 60, curve: 'instant' as const },
];
export const PREFIX_TEMPO_BPM = 120;
export const SECTIONS = [
    { id: 'verse', name: 'Verse', startBeat: 0, endBeat: 8, color: '#ffffff' },
    { id: 'chorus', name: 'Chorus', startBeat: 8, endBeat: 16, color: '#ffffff' },
];

/** A real project whose live tempo map is `LIVE_TEMPO_MAP`, with the handlers a `setTempo` batch needs. */
export function configureTempoMapProject(runId: string, sections: typeof SECTIONS | []): void {
    configureMetricGoalProject({
        label: runId,
        tracks: [createTrack({ id: 'master', name: 'Master', kind: 'master' })],
        sections,
        tempo: 120,
    });
    registerHandlerMap(getTransportHandlers());
    restoreTimelineMapSnapshot({ tempoMap: { changes: LIVE_TEMPO_MAP } });
    // The map reaches the document on this flush; left pending it would land mid-preview and move the revision.
    flushAutomergeStorageWrites();
}

/** The prepared batch of one `setTempo` action, compiled and parsed as the preview hands it in. */
export function compileTempoBatch(runId: string, intent: string) {
    const compiled = compileAgentActionExecution({
        actions: [{ type: 'setTempo', payload: { bpm: PREFIX_TEMPO_BPM } }],
        actionLabels: ['setTempo'],
        context: getProjectContext(),
        intent,
        projectRevision: captureProjectRevision(),
        runId,
        group: { groupId: runId, groupLabel: intent },
        requiresConfirmation: true,
    });
    const parsed = parseVersionedCommandBatchEnvelope(
        compiled.commandBatch.serialized,
        compiled.commandBatch.authority
    );
    if (parsed.status !== 'valid') {
        throw new Error('The tempo batch compiles to a valid envelope.');
    }
    return { compiled, envelope: parsed.envelope };
}
