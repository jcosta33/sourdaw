import { elasticAudioStore } from '#/modules/ElasticAudio/stores';
import { toggleMarkerLock } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticToggleMarkerLock = createHandler<'elasticToggleMarkerLock'>({
    execute: (a) => {
        // Warp-marker identity is clip-local (#5570): the typed route targets
        // the clip open in the elastic editor, the same owner the panel passes;
        // with no clip open there is nothing to edit.
        const ownerClipId = elasticAudioStore.value?.openClipId ?? null;
        if (ownerClipId !== null) {
            toggleMarkerLock(ownerClipId, a.payload.markerId);
        }
    },
    describe: () => ({ label: 'Toggle Elastic Marker Lock' }),
    undoable: false,
});
