import { trackStore } from '#/modules/Arrangement/stores';
import { renameClip, splitClip } from '#/modules/Arrangement/useCases';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';

import { executeAppAction } from '../../useCases/executeAppAction';
import { getSelectedClipId } from '../../useCases/selectionHelpers/getSelectedClipId';
import { getSelectedClipIds } from '../../useCases/selectionHelpers/getSelectedClipIds';
import { getSelectedTrackId } from '../../useCases/selectionHelpers/getSelectedTrackId';
import { type CommandEntry } from '../CommandEntry';

/** Clip commands — rename, split, normalize, reverse, glue, loop, consolidate. */
export const clipCommands: CommandEntry[] = [
    {
        id: 'rename-clip',
        label: 'Rename Clip',
        description: 'Rename the selected clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                const track = trackStore.value?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
                const clip = track?.clips.find((c) => c.id === clipId);
                const name = window.prompt('Rename clip:', clip?.name ?? '');
                if (name !== null && name.trim()) {
                    renameClip(clipId, name.trim());
                }
            }
        },
    },
    {
        id: 'split-clip',
        label: 'Split Clip at Playhead',
        description: 'Split the selected clip at the current playhead position',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            const beat = transportStore.value ? playheadPositionRef.current : 0;
            if (clipId) {
                splitClip(clipId, beat);
            }
        },
    },
    {
        id: 'normalize-clip',
        label: 'Normalize Clip',
        description: 'Peak-normalize the selected audio clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'normalizeClip', payload: { clipId } });
            }
        },
    },
    {
        id: 'reverse-clip',
        label: 'Reverse Clip',
        description: 'Reverse the selected audio clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                void executeAppAction({ type: 'reverseClip', payload: { clipId } });
            }
        },
    },
    {
        id: 'glue-clips',
        label: 'Glue Selected Clips',
        description: 'Merge selected clips into one',
        category: 'Clip',
        action: () => {
            const ids = getSelectedClipIds();
            if (ids.length >= 2) {
                void executeAppAction({ type: 'glueClips', payload: { clipIds: ids } });
            }
        },
    },
    {
        id: 'consolidate-selection',
        label: 'Consolidate Selection',
        description: 'Consolidate the selection range into a single clip',
        category: 'Clip',
        action: () => {
            const trackId = getSelectedTrackId();
            const clipId = getSelectedClipId();
            if (trackId && clipId) {
                const track = trackStore.value?.tracks.find((t) => t.id === trackId);
                const clip = track?.clips.find((c) => c.id === clipId);
                if (clip) {
                    void executeAppAction({
                        type: 'consolidateSelection',
                        payload: { trackId, startBeat: clip.startBeat, endBeat: clip.endBeat },
                    });
                }
            }
        },
    },
    {
        id: 'set-clip-loop',
        label: 'Toggle Clip Loop',
        description: 'Enable or disable looping on the selected clip',
        category: 'Clip',
        action: () => {
            const clipId = getSelectedClipId();
            if (clipId) {
                const track = trackStore.value?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
                const clip = track?.clips.find((c) => c.id === clipId);
                if (clip) {
                    void executeAppAction({ type: 'setClipLoop', payload: { clipId, enabled: !clip.loopEnabled } });
                }
            }
        },
    },
];
