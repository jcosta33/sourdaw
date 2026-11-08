import { useEffect, useRef } from 'react';

import { openCachedAudioBufferHold } from '#/modules/AudioEngine/useCases';

type ImportedSampleResidencyHold = ReturnType<typeof openCachedAudioBufferHold>;

/** Residency for sidebar-imported sample PCM for as long as the Sidebar is mounted. */
export function useImportedSampleResidency(): () => ImportedSampleResidencyHold {
    const holdRef = useRef<ImportedSampleResidencyHold | null>(null);

    useEffect(
        () => () => {
            holdRef.current?.release();
            holdRef.current = null;
        },
        []
    );

    return () => {
        holdRef.current ??= openCachedAudioBufferHold();
        return holdRef.current;
    };
}
