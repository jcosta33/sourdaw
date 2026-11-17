import { preferencesStore, type Preferences } from '#/modules/Preferences/stores';
import { TRACK_HEIGHT_VALUES } from '#/modules/Preferences/useCases';

export function getTimelineTrackHeightScale(
    mode: Preferences['trackHeight'] = preferencesStore.value?.trackHeight ?? 'normal'
): number {
    return TRACK_HEIGHT_VALUES[mode] / TRACK_HEIGHT_VALUES.normal;
}
