import { type AppAction } from '#/utils/handlerContract';

/** The layer region copy in words, or `null` until its scope facts are materialized. */
export function describeExactAdjustmentRegion(
    action: Extract<AppAction, { type: 'addAdjustmentRegion' }>
): string | null {
    if (
        !action.payload.expectedLayer ||
        !action.payload.sourceRegionId ||
        !action.payload.sourceSection ||
        !action.payload.targetSection
    ) {
        return null;
    }
    const sourceRegion = action.payload.expectedLayer.regions.find(
        (region) => region.id === action.payload.sourceRegionId
    );
    const tracks = (action.payload.expectedTracks ?? [])
        .map((track) => `"${track.trackName}" (${track.trackId})`)
        .join(', ');
    if (!sourceRegion) {
        return null;
    }
    return `Copy ${action.payload.expectedLayer.effectType} layer "${action.payload.expectedLayer.name}" (${action.payload.layerId}) on ${tracks} from "${action.payload.sourceSection.name}" (${action.payload.sourceSection.id}) region ${sourceRegion.id} beats ${String(sourceRegion.startBeat)}–${String(sourceRegion.endBeat)} to "${action.payload.targetSection.name}" (${action.payload.targetSection.id}) as ${action.payload.regionId ?? 'application-assigned region'} beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}, blend ${String(action.payload.blend ?? 1)}, fades ${String(action.payload.fadeInBeats ?? 0.25)}/${String(action.payload.fadeOutBeats ?? 0.25)} beats; preserve layer parameters and mix`;
}
