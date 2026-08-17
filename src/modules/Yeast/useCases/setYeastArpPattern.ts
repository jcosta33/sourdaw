import { type ArpStep, withArpPatternParams } from '../models/ArpPattern';
import { publishAppliedYeastPreviewRevision, publishPendingYeastPreviewRevision } from '../stores/yeastPreviewRevision';
import { yeastStore } from '../stores/yeastStore';

import { applyYeastControlProjection } from './applyYeastControlProjection';
import { commitYeastProjection } from './commitYeastProjection';
import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';

/**
 * Commit an arpeggiator's custom step pattern.
 *
 * The pattern is stored as the `pattern_`-prefixed subset of the processor's
 * numeric params (see `models/ArpPattern`), so it rides the same single write
 * path as every other Yeast param: `commitYeastProjection` persists and
 * replicates it through the store's Automerge document, and the runtime
 * projection carries it to the Worker's `Arpeggiator.setPattern`.
 *
 * There is no transient variant. A step edit is a discrete gesture (a click on
 * a cell), not a drag, so nothing here needs the preview-only projection path
 * that `setYeastProcessorParam` uses for continuous knob motion.
 */
export async function setYeastArpPattern(id: string, steps: readonly ArpStep[]): Promise<void> {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const processor = state.processors.find((entry) => entry.id === id);
    if (!processor || processor.type !== 'arpeggiator') {
        return;
    }

    const revisionDetails = { processorId: id, parameterName: 'pattern', transient: false };
    const revision = publishPendingYeastPreviewRevision(revisionDetails);
    commitYeastProjection(
        state.processors.map((entry) =>
            entry.id === id ? { ...entry, params: withArpPatternParams(entry.params, steps) } : entry
        )
    );
    const currentState = yeastStore.value;
    if (!currentState) {
        return;
    }
    await applyYeastControlProjection(createYeastRuntimeProjection(currentState.processors));
    publishAppliedYeastPreviewRevision({ ...revisionDetails, revision });
}
