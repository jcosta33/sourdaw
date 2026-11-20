import { preferencesStore, type Preferences } from '#/modules/Preferences/stores';
import { TRACK_HEIGHT_VALUES } from '#/modules/Preferences/useCases';

export function getTimelineTrackHeightMode(): Preferences['trackHeight'] {
    return preferencesStore.value?.trackHeight ?? 'normal';
}

export function getTimelineTrackHeightScale(mode = getTimelineTrackHeightMode()): number {
    return TRACK_HEIGHT_VALUES[mode] / TRACK_HEIGHT_VALUES.normal;
}
