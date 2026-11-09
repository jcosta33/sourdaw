import { useEffect, useRef } from 'react';

import { openCachedAudioBufferHold } from '#/modules/AudioEngine/useCases';

type ImportedSampleResidencyHold = ReturnType<typeof openCachedAudioBufferHold>;

/** Residency for sidebar-imported sample PCM for as long as the Sidebar is mounted. */
export function useImportedSampleResidency(): () => ImportedSampleResidencyHold | null {
    const holdRef = useRef<ImportedSampleResidencyHold | null>(null);
    const mountedRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            holdRef.current?.release();
            holdRef.current = null;
        };
    }, []);

    return () => {
        if (!mountedRef.current) {
            return null;
        }
        holdRef.current ??= openCachedAudioBufferHold();
        return holdRef.current;
    };
}
