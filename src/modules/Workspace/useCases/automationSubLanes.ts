import { inject } from '#/infra/di/inject';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';

/**
 * Set the automation sub-lane parameter IDs for a specific track.
 */
export const setAutomationSubLanes = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function setAutomationSubLanes(trackId: string, paramIds: string[]): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({
                automationSubLanes: {
                    ...current.automationSubLanes,
                    [trackId]: paramIds,
                },
            });
        }
);

/**
 * Add an automation sub-lane parameter to a track.
 */
export const addAutomationSubLane = inject({ getWorkspaceState })(
    ({ getWorkspaceState }) =>
        function addAutomationSubLane(trackId: string, paramId: string): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            const existing = current.automationSubLanes[trackId] ?? [];
            setAutomationSubLanes(trackId, [...existing, paramId]);
        }
);

/**
 * Remove an automation sub-lane at a specific index from a track.
 */
export const removeAutomationSubLane = inject({ getWorkspaceState })(
    ({ getWorkspaceState }) =>
        function removeAutomationSubLane(trackId: string, index: number): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            const existing = current.automationSubLanes[trackId] ?? [];
            setAutomationSubLanes(
                trackId,
                existing.filter((_, i) => i !== index)
            );
        }
);

/**
 * Swap the parameter at a specific index in a track's sub-lanes.
 */
export const swapAutomationSubLaneParam = inject({ getWorkspaceState })(
    ({ getWorkspaceState }) =>
        function swapAutomationSubLaneParam(trackId: string, index: number, newParamId: string): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            const existing = [...(current.automationSubLanes[trackId] ?? [])];
            existing[index] = newParamId;
            setAutomationSubLanes(trackId, existing);
        }
);
