/**
 * Create a drum machine track stack — Logic Pro Drum Machine Designer style.
 *
 * Logic Pro DMD model:
 * - One parent track that IS the drum machine (has the Grinder device)
 * - 16 child tracks underneath, one per pad
 * - Each child track is a full channel strip for that pad
 * - Selecting a child track shows that pad's controls
 * - MIDI on a child track routes to the corresponding pad on the parent Grinder
 * - No extra "instrument" track — the folder IS the instrument
 */

import { createTrack } from '#/modules/Arrangement/models/Track';
import { getTrackState, setTrackState } from '#/modules/Arrangement/repositories/track';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases/deviceControls';
import { DEFAULT_PAD_NAMES, PAD_COLORS } from '../models/GrinderKit';
import { eventBus } from '#/app/bootstrap';
import { TrackAddedEvent } from '#/modules/Arrangement/events/TrackAddedEvent';

export function createDrumTrackStack(): string | null {
    const state = getTrackState();
    if (!state) { return null; }

    // Parent is a folder — gives it collapse/expand UI, smaller height, groups children
    const parent = createTrack({ name: 'Grinder Kit', kind: 'folder' });
    parent.collapsed = false;
    const grinderId = `grinder-${crypto.randomUUID().slice(0, 8)}`;
    parent.devices = [{
        id: grinderId,
        name: 'Grinder',
        type: 'grinder',
        bypassed: false,
        parameterValues: {},
    }];

    // 16 child tracks — one per pad, nested under the parent
    const children = Array.from({ length: 16 }, (_, i) => {
        const child = createTrack({
            name: DEFAULT_PAD_NAMES[i] ?? `Pad ${i + 1}`,
            kind: 'midi',
            parentId: parent.id,
        });
        child.devices = [];           // no default synth — routes to parent Grinder
        child.outputId = parent.id;    // audio routes through parent
        child.color = PAD_COLORS[i] ?? child.color;
        return child;
    });

    // Commit all tracks in one batch
    setTrackState({
        ...state,
        tracks: [...state.tracks, parent, ...children],
        selectedTrackId: parent.id,
    });

    // Wire the Grinder device into the audio engine
    addDeviceToStrip(parent.id, grinderId, 'grinder');

    eventBus.emit(new TrackAddedEvent({ trackId: parent.id, name: parent.name, kind: parent.kind }));

    return parent.id;
}
