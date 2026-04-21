/**
 * Create a drum machine track stack — Logic Pro Drum Machine Designer style.
 *
 * Logic Pro DMD model:
 * - One parent track that IS the drum machine (has the Toaster device)
 * - 16 child tracks underneath, one per pad
 * - Each child track is a full channel strip for that pad
 * - Selecting a child track shows that pad's controls
 * - MIDI on a child track routes to the corresponding pad on the parent Toaster
 * - No extra "instrument" track — the folder IS the instrument
 */

import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { createTrack, getTrackStoreState, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases';

import { DEFAULT_PAD_NAMES, PAD_COLORS } from '../models/ToasterKit';

export const createDrumTrackStack = inject({ eventBus })(
    ({ eventBus }) =>
        function createDrumTrackStack(): string | null {
            const state = getTrackStoreState();
            if (!state) {
                return null;
            }

            // Parent is a folder — gives it collapse/expand UI, smaller height, groups children
            const parent = createTrack({ name: 'Toaster Kit', kind: 'folder' });
            parent.collapsed = false;
            const toasterId = `toaster-${crypto.randomUUID().slice(0, 8)}`;
            parent.devices = [
                {
                    id: toasterId,
                    name: 'Toaster',
                    type: 'toaster',
                    bypassed: false,
                    parameterValues: {},
                },
            ];

            // 16 child tracks — one per pad, nested under the parent
            const children = Array.from({ length: 16 }, (_, index) => {
                const child = createTrack({
                    name: DEFAULT_PAD_NAMES[index] ?? `Pad ${index + 1}`,
                    kind: 'midi',
                    parentId: parent.id,
                });
                child.devices = []; // no default synth — routes to parent Toaster
                child.outputId = parent.id; // audio routes through parent
                child.color = PAD_COLORS[index] ?? child.color;
                return child;
            });

            // Commit all tracks in one batch
            setTrackStoreState({
                ...state,
                tracks: [...state.tracks, parent, ...children],
                selectedTrackId: parent.id,
            });

            // Wire the Toaster device into the audio engine
            void addDeviceToStrip(parent.id, toasterId, 'toaster');

            void eventBus.emit('track.added', { trackId: parent.id, name: parent.name, kind: parent.kind });

            return parent.id;
        }
);
