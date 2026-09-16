/**
 * Write the Crumbs attachments an answer reported into the Crumbs mirror.
 *
 * Its own file beside {@link markAttachedInstances}, and for the same reason
 * that one is separate: the reporter that calls both also triggers the splice,
 * and importing it back here would close a cycle `no-circular` refuses.
 *
 * Every outcome is read, unlike {@link markAttachedInstances}, because the two
 * attaches run at different points of `apply_graph_commands`. A dormant plugin
 * is taken after the batch is fenced, so only an applied answer can have taken
 * one. A dormant Crumbs instance is taken *before* the batch is mapped — that
 * is what lets the instance bind within the same batch rather than the next one
 * — so a batch that is then refused, or that only partly applies, has still
 * attached it. Reading only the applied answers would leave that sampler on Web
 * Audio until some later batch happened to report it again, and a refusal is
 * exactly when the producer resends.
 *
 * An attach is therefore a fact about the call, not about the batch's outcome.
 * An answer carrying no field attached nothing, which is also what a backend
 * hosting no engine reports.
 */

import { markCrumbsEngineAttached } from '#/modules/Crumbs/useCases';

import { type AudioGraphApplyResult } from '../../models/AudioGraphBackend';

export function markAttachedCrumbsInstances(result: AudioGraphApplyResult): void {
    for (const attached of result.attachedCrumbs ?? []) {
        markCrumbsEngineAttached({ instanceId: attached.instanceId });
    }
}
