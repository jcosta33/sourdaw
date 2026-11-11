import { trackStore } from '#/modules/Arrangement/stores';
import { renameClip, splitClip } from '#/modules/Arrangement/useCases';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';
import { promptUser } from '#/utils/Notification/promptUser';

import { executeCommandAction } from '../executeCommandAction';
import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getSelectedClipId } from '../selectionHelpers/getSelectedClipId';
import { getSelectedClipIdOfType } from '../selectionHelpers/getSelectedClipIdOfType';
import { getSelectedClipIds } from '../selectionHelpers/getSelectedClipIds';
import { getSelectedTrackId } from '../selectionHelpers/getSelectedTrackId';

/** Clip commands — rename, split, normalize, reverse, glue, loop, consolidate. */
export const clipCommands: CallableCommandEntry[] = [
    {
        id: 'rename-clip',
        label: 'Rename Clip',
        description: 'Rename the selected clip',
        category: 'Clip',
        getInapplicabilityReason: () => (getSelectedClipId() ? null : 'Select a clip first.'),
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipId();
            if (!clipId) {
                return;
            }
            const track = trackStore.value?.tracks.find((candidate) =>
                candidate.clips.some((clip) => clip.id === clipId)
            );
            const clip = track?.clips.find((candidate) => candidate.id === clipId);
            void (async () => {
                const name = await promptUser({
                    title: 'Rename Clip',
                    message: 'New clip name',
                    initialValue: clip?.name ?? '',
                    confirmLabel: 'Rename',
                });
                if (name) {
                    renameClip(clipId, name);
                    onCommitted?.();
                }
            })();
        },
    },
    {
        id: 'split-clip',
        label: 'Split Clip at Playhead',
        description: 'Split the selected clip at the current playhead position',
        category: 'Clip',
        getInapplicabilityReason: () => (getSelectedClipId() ? null : 'Select a clip first.'),
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipId();
            const beat = transportStore.value ? playheadPositionRef.current : 0;
            if (clipId) {
                splitClip(clipId, beat);
                onCommitted?.();
            }
        },
    },
    {
        id: 'normalize-clip',
        label: 'Normalize Clip',
        description: 'Peak-normalize the selected audio clip',
        category: 'Clip',
        getInapplicabilityReason: () => (getSelectedClipIdOfType('audio') ? null : 'Select an audio clip first.'),
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipIdOfType('audio');
            if (clipId) {
                void executeCommandAction(onCommitted, { type: 'normalizeClip', payload: { clipId } });
            }
        },
    },
    {
        id: 'reverse-clip',
        label: 'Reverse Clip',
        description: 'Reverse the selected audio clip',
        category: 'Clip',
        getInapplicabilityReason: () => (getSelectedClipIdOfType('audio') ? null : 'Select an audio clip first.'),
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipIdOfType('audio');
            if (clipId) {
                void executeCommandAction(onCommitted, { type: 'reverseClip', payload: { clipId } });
            }
        },
    },
    {
        id: 'glue-clips',
        label: 'Glue Selected Clips',
        description: 'Merge selected clips into one',
        category: 'Clip',
        getInapplicabilityReason: () => (getSelectedClipIds().length >= 2 ? null : 'Select at least two clips first.'),
        action: (onCommitted?: () => void) => {
            const ids = getSelectedClipIds();
            if (ids.length >= 2) {
                void executeCommandAction(onCommitted, { type: 'glueClips', payload: { clipIds: ids } });
            }
        },
    },
    {
        id: 'consolidate-selection',
        label: 'Consolidate Selection',
        description: 'Consolidate the selection range into a single clip',
        category: 'Clip',
        getInapplicabilityReason: () => (getSelectedClipId() ? null : 'Select a clip first.'),
        action: (onCommitted?: () => void) => {
            const trackId = getSelectedTrackId();
            const clipId = getSelectedClipId();
            if (trackId && clipId) {
                const track = trackStore.value?.tracks.find((time) => time.id === trackId);
                const clip = track?.clips.find((context) => context.id === clipId);
                if (clip) {
                    void executeCommandAction(onCommitted, {
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
        getInapplicabilityReason: () => (getSelectedClipId() ? null : 'Select a clip first.'),
        action: (onCommitted?: () => void) => {
            const clipId = getSelectedClipId();
            if (clipId) {
                const track = trackStore.value?.tracks.find((time) =>
                    time.clips.some((context) => context.id === clipId)
                );
                const clip = track?.clips.find((context) => context.id === clipId);
                if (clip) {
                    void executeCommandAction(onCommitted, {
                        type: 'setClipLoop',
                        payload: { clipId, enabled: !clip.loopEnabled },
                    });
                }
            }
        },
    },
];
