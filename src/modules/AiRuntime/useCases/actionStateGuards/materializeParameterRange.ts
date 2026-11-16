import { resolveMusicalRange } from '#/modules/Arrangement/useCases';
import { getBarAtBeat, getBarStartBeat } from '#/modules/Transport/useCases';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'automateParameterRange' }>;
type MusicalRangeResolution = ReturnType<typeof resolveMusicalRange>;

function askWhichSection(
    resolution: Extract<MusicalRangeResolution, { kind: 'ambiguous-section' }>
): readonly string[] {
    const candidates = resolution.candidates
        .map((section) => `"${section.name}" from beat ${String(section.startBeat)} to ${String(section.endBeat)}`)
        .join(', or ');
    return [`Which part of the song do you mean by "${resolution.reference}": ${candidates}?`];
}

/**
 * The beats a range write covers in the plan's own project snapshot, so the
 * production-brief guard that follows reads the interval the write will touch.
 * The owning handler resolves the same range again against the live project
 * when the command is admitted.
 */
export function materializeParameterRange(action: Action, state: MaterializationState): MaterializationStep {
    const { context } = state;
    const resolution = resolveMusicalRange({
        range: action.payload.range,
        sections: context.sections ?? [],
        markers: context.markers ?? [],
        tracks: context.tracks,
        barStartBeat: getBarStartBeat,
        barAtBeat: getBarAtBeat,
    });
    if (resolution.kind === 'ambiguous-section') {
        return { status: 'rejected', reason: resolution.reason, questions: askWhichSection(resolution) };
    }
    if (resolution.kind !== 'resolved') {
        return { status: 'rejected', reason: resolution.reason };
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'automateParameterRange',
                payload: { ...action.payload, startBeat: resolution.startBeat, endBeat: resolution.endBeat },
            },
        ],
    };
}
