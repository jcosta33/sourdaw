import { elasticAudioStore } from '#/modules/ElasticAudio/stores';
import { removeMarker } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleElasticRemoveMarker = createHandler<'elasticRemoveMarker'>({
    execute: (a) => {
        // Warp-marker identity is clip-local (#5570): the typed route targets
        // the clip open in the elastic editor, the same owner the panel passes;
        // with no clip open there is nothing to edit.
        const ownerClipId = elasticAudioStore.value?.openClipId ?? null;
        if (ownerClipId !== null) {
            removeMarker(ownerClipId, a.payload.markerId);
        }
    },
    describe: () => ({ label: 'Remove Elastic Marker' }),
    undoable: false,
});
