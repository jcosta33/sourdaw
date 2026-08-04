import { deriveVcaMultiplier, getVcaGroupsState } from '#/modules/Arrangement/stores';
import { scheduleTrackGain } from '#/modules/AudioEngine/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

type ScheduleComposedTrackGainAutomationInput = {
    trackId: string;
    vcaGroupId?: string | null;
    value: number;
    minValue: number;
    time: number;
};

export function scheduleComposedTrackGainAutomation({
    trackId,
    vcaGroupId,
    value,
    minValue,
    time,
}: ScheduleComposedTrackGainAutomationInput): void {
    const linearGain = minValue < 0 ? dbToGain(value) : value;
    const vcaMultiplier = deriveVcaMultiplier({ vcaGroupId, groups: getVcaGroupsState() });
    scheduleTrackGain(trackId, linearGain * vcaMultiplier, time);
}
