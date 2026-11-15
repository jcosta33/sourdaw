import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'renderProjectSections' }>;

export function materializeSectionRenders(action: Action, state: MaterializationState): MaterializationStep {
    const { context, options } = state;
    const tailSeconds = options.appOwnedRenderTailSeconds;
    if (tailSeconds === undefined || !Number.isFinite(tailSeconds) || tailSeconds < 0) {
        return { status: 'rejected', reason: 'Section render tail was not materialized by the application' };
    }
    const sectionsById = new Map((context.sections ?? []).map((section) => [section.id, section]));
    const jobs = [];
    for (const sectionId of action.payload.sectionIds) {
        const section = sectionsById.get(sectionId);
        if (!section || !Number.isFinite(section.startBeat) || section.endBeat <= section.startBeat) {
            return { status: 'rejected', reason: `Section cannot be rendered: ${sectionId}` };
        }
        jobs.push({
            jobId: `render-job-ai-${crypto.randomUUID()}`,
            sectionId,
            sectionName: section.name,
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            sampleRate: 44_100,
            tailSeconds,
        });
    }
    return { status: 'accepted', actions: [{ type: 'renderProjectSections', payload: { ...action.payload, jobs } }] };
}
