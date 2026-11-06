import { setAutomationSubLanes as setTimelineAutomationSubLanes } from '#/modules/Arrangement/useCases';

export function setAutomationSubLanes(trackId: string, paramIds: string[]): void {
    setTimelineAutomationSubLanes(trackId, paramIds);
}
