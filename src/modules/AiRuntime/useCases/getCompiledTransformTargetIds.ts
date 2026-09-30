import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../models/ProjectContext';
import { type ToolCallResult } from '../transformers/toolCallParser';

/** Stable targets the application compiler emitted from the captured project read model. */
export function getCompiledTransformTargetIds(commands: readonly ToolCallResult[], context: ProjectContext): string[] {
    const known = new Set([
        ...context.tracks.flatMap((track) => [
            track.id,
            ...track.clips.map((clip) => clip.id),
            ...track.devices.map((device) => device.id),
        ]),
        ...(context.automationLanes ?? []).map((lane) => lane.id),
        ...(context.adjustmentLayers ?? []).flatMap((layer) => [layer.id, ...layer.regions.map((region) => region.id)]),
        ...(context.sections ?? []).map((section) => section.id),
        ...(context.sidechainRoutes ?? []).map((route) => route.id),
        ...(context.vcaGroups ?? []).map((group) => group.id),
    ]);
    const result = new Set<string>();
    for (const command of commands) {
        const rules = getExecutableAppActionGroundingRules(command.name);
        for (const rule of rules?.targetRules ?? []) {
            const value = command.arguments[rule.argument];
            const ids = Array.isArray(value) ? value : [value];
            for (const id of ids) {
                if (typeof id === 'string' && known.has(id)) {
                    result.add(id);
                }
            }
        }
    }
    return [...result];
}
