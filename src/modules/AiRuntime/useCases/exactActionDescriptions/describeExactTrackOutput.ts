import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The output route in words, or `null` when its source or target is unknown. */
export function describeExactTrackOutput(
    action: Extract<AppAction, { type: 'setTrackOutput' }>,
    context: ProjectContext,
    actions: readonly AppAction[]
): string | null {
    const source = context.tracks.find((track) => track.id === action.payload.trackId);
    const existingTarget = context.tracks.find((track) => track.id === action.payload.outputId);
    const createdTarget = actions.find(
        (candidate) => candidate.type === 'createBus' && candidate.payload.busId === action.payload.outputId
    );
    const targetName =
        existingTarget?.name ?? (createdTarget?.type === 'createBus' ? createdTarget.payload.name : null);
    if (!source || !targetName) {
        return null;
    }
    const previousOutput = action.payload.expectedOutputId ?? source.outputId ?? 'master';
    return `Route "${source.name}" (${source.id}) from ${previousOutput} to "${targetName}" (${action.payload.outputId})`;
}
