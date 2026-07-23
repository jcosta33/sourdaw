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
    const children = tracks.filter((track) => track.parentId === parentId);
    for (const child of children) {
        setTrackOutput(child.id, child.outputId);
    }
    for (const child of children) {
        const binding = resolveToasterPadBinding(tracks, child.id);
        if (binding) {
            setTrackOutput(child.id, child.outputId, binding);
        }
    }
}
