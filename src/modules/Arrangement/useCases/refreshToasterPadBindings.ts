import { resolveToasterPadBinding, setTrackOutput } from '#/modules/AudioEngine/useCases';

import { type Track } from '../stores/trackStore';

export function refreshToasterPadBindings(tracks: readonly Track[], parentId: string | null): void {
    if (!parentId) {
        return;
    }
    const parents = tracks.filter((track) => track.id === parentId);
    if (parents.length !== 1 || !parents[0]!.devices.some((device) => device.type === 'toaster')) {
        return;
    }
    for (const child of tracks) {
        if (child.parentId !== parentId) {
            continue;
        }
        setTrackOutput(child.id, child.outputId, resolveToasterPadBinding(tracks, child.id));
    }
}
