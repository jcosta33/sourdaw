import { trackStore } from '#/modules/Arrangement/stores';
import { duplicateTrack, removeTrack } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { promptUser } from '#/utils/Notification/promptUser';

import { type CallableCommandEntry } from '../searchCommandRegistry';
import { getSelectedTrackId } from '../selectionHelpers/getSelectedTrackId';

/** Track commands — add, duplicate, delete, rename, freeze, mute, solo, group, arm. */
export const trackCommands: CallableCommandEntry[] = [
    {
        id: 'add-audio-track',
        label: 'Add Audio Track',
        description: 'Create a new audio track',
        category: 'Track',
        shortcut: '⇧N',
        action: { type: 'addTrack', payload: { name: 'Audio', kind: 'audio' } },
    },
    {
        id: 'add-midi-track',
        label: 'Add MIDI Track',
        description: 'Create a new MIDI track',
        category: 'Track',
        shortcut: 'N',
        action: { type: 'addTrack', payload: { name: 'MIDI', kind: 'midi' } },
    },
    {
        id: 'add-bus',
        label: 'Add Bus Track',
        description: 'Create a new bus track',
        category: 'Track',
        action: () => {
            void executeAppAction({ type: 'createBus', payload: { name: 'Bus' } });
        },
    },
    {
        id: 'add-folder',
        label: 'Create Folder',
        description: 'Create a track folder',
        category: 'Track',
        action: { type: 'createFolder', payload: { name: 'Folder' } },
    },
    {
        id: 'duplicate-track',
        label: 'Duplicate Track',
        description: 'Duplicate the selected track with all clips and devices',
        category: 'Track',
        shortcut: '⌘⇧D',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                duplicateTrack(id);
            }
        },
    },
    {
        id: 'delete-track',
        label: 'Delete Track',
        description: 'Remove the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                removeTrack(id);
            }
        },
    },
    {
        id: 'rename-track',
        label: 'Rename Track',
        description: 'Rename the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (!id) {
                return;
            }
            const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
            void (async () => {
                const name = await promptUser({
                    title: 'Rename Track',
                    message: 'New track name',
                    initialValue: track?.name ?? '',
                    confirmLabel: 'Rename',
                });
                if (name) {
                    await executeAppAction({ type: 'renameTrack', payload: { trackId: id, name } });
                }
            })();
        },
    },
    {
        id: 'freeze-track',
        label: 'Freeze Track',
        description: 'Freeze the selected track to save CPU',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'freezeTrack', payload: { trackId: id } });
            }
        },
    },
    {
        id: 'unfreeze-track',
        label: 'Unfreeze Track',
        description: 'Unfreeze the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'unfreezeTrack', payload: { trackId: id } });
            }
        },
    },
    {
        id: 'flatten-track',
        label: 'Flatten Track',
        description: 'Commit a frozen track to audio',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'flattenTrack', payload: { trackId: id } });
            }
        },
    },
    {
        id: 'bounce-to-new-track',
        label: 'Bounce to New Track',
        description: 'Render the selected track to a new audio track',
        category: 'Track',
        action: () => {
            const trackId = getSelectedTrackId();
            if (trackId) {
                void executeAppAction({ type: 'bounceToNewTrack', payload: { trackId } });
            }
        },
    },
    {
        id: 'bounce-in-place',
        label: 'Bounce in Place',
        description: 'Render the selected track to audio in place',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'bounceInPlace', payload: { trackId: id } });
            }
        },
    },
    {
        id: 'arm-track',
        label: 'Arm Track',
        description: 'Arm the selected track for recording',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'armTrack', payload: { trackId: id, armed: true } });
            }
        },
    },
    {
        id: 'solo-track',
        label: 'Solo Track',
        description: 'Solo the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'soloTrack', payload: { trackId: id, soloed: true } });
            }
        },
    },
    {
        id: 'mute-track',
        label: 'Mute Track',
        description: 'Mute the selected track',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'muteTrack', payload: { trackId: id, muted: true } });
            }
        },
    },
    {
        id: 'group-tracks',
        label: 'Group Selected Tracks',
        description: 'Link selected tracks into a group',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                void executeAppAction({ type: 'groupTracks', payload: { trackIds: [id], name: 'Group' } });
            }
        },
    },
    {
        id: 'clear-solos',
        label: 'Clear All Solos',
        description: 'Unsolo all tracks',
        category: 'Track',
        shortcut: '⌥S',
        action: { type: 'clearSolos' },
    },
    {
        id: 'consolidate-all-tracks',
        label: 'Consolidate All Tracks',
        description: 'Bounce in place all audio and MIDI tracks',
        category: 'Track',
        action: { type: 'consolidateAllTracks' },
    },
    {
        id: 'ungroup-tracks',
        label: 'Ungroup Tracks',
        description: 'Remove track grouping',
        category: 'Track',
        action: () => {
            const id = getSelectedTrackId();
            if (id) {
                const track = trackStore.value?.tracks.find((time) => time.id === id);
                if (track?.groupId) {
                    void executeAppAction({ type: 'ungroupTracks', payload: { groupId: track.groupId } });
                }
            }
        },
    },
];
