import { previewVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { DEFAULT_TEMPO_BPM, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { compilePreviewPrefix } from './compilePreviewPrefix';

type PrefixInput = Parameters<typeof compilePreviewPrefix>[0];

/** The tempo and tempo map of whichever document's stores answer while this runs. */
function readTimeline() {
    return { tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM, changes: tempoMapStore.value?.changes ?? [] };
}

/**
 * The tempo and tempo map of the document a prefix names, read from the isolated workspace its
 * preview renders in, compiled from the same inputs the preview unit compiles it from. A prefix
 * that does not compile or open here reads the live project's timeline: its unit compiles and
 * opens it again from those same inputs before anything renders, and fails there, so no render is
 * ever grouped by that reading.
 */
export function readPreviewPrefixTimeline(input: PrefixInput): ReturnType<typeof readTimeline> {
    const compiled = compilePreviewPrefix(input);
    if ('code' in compiled) {
        return readTimeline();
    }
    const preview = previewVersionedCommandBatchEnvelope(compiled.envelope);
    if (preview.status !== 'previewed') {
        return readTimeline();
    }
    try {
        return preview.workspace.scope(readTimeline);
    } finally {
        preview.resource.release();
    }
}
