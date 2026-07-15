import { type HydratableArrangementSnapshot, type HydratableProjectData } from './isHydratableProjectData';

export function resolveActiveArrangementSnapshot(
    data: HydratableProjectData
): HydratableArrangementSnapshot | undefined {
    const arrangements = data.arrangements;
    if (!arrangements || arrangements.length === 0) {
        return undefined;
    }
    return arrangements.find((arrangement) => arrangement.id === data.activeArrangementId) ?? arrangements[0];
}
