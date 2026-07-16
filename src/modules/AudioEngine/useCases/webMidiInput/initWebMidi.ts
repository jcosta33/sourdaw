import { Container } from '#/infra/di/Container';
import { trackStore } from '#/modules/Arrangement/stores';

import { initWebMidi as initializeWebMidi } from '../../repositories/webMidi/lifecycle/initWebMidi';
import { routeYeastNoteOffsForTargetTrack } from '../../repositories/webMidi/routeYeastNoteOff';
import { WebMidiEventBus } from '../../repositories/webMidi/webMidiEventBus';

import { handleWebMidiMessage } from './handleWebMidiMessage';
import { resolveInstrumentTrack } from './resolveInstrumentTrack';
import { setMidiInputTrack } from './setMidiInputTrack';

let trackStoreSubscribed = false;
let yeastNotesOffSubscribed = false;

function subscribeToTrackSelection(): void {
    if (trackStoreSubscribed) {
        return;
    }
    trackStoreSubscribed = true;

    let previousSelectedId: string | null = null;
    trackStore.subscribe((trackState) => {
        const selectedId = trackState?.selectedTrackId ?? null;
        if (selectedId === previousSelectedId) {
            return;
        }
        previousSelectedId = selectedId;
        if (!selectedId) {
            setMidiInputTrack(null);
            return;
        }
        const selectedTrack = trackState?.tracks.find((track) => track.id === selectedId);
        if (selectedTrack?.kind === 'midi') {
            setMidiInputTrack(selectedId);
        }
    });
}

function subscribeToYeastNotesOff(): void {
    if (yeastNotesOffSubscribed) {
        return;
    }
    yeastNotesOffSubscribed = true;

    const eventBus = Container.get(WebMidiEventBus);
    eventBus.on('yeast.notesOff', ({ trackId, noteOffs }) => {
        const resolvedInstrument = resolveInstrumentTrack(trackStore.value, trackId);
        const instrumentTrack = resolvedInstrument?.instrumentTrack;
        const instrumentSnapshot = instrumentTrack
            ? {
                  id: instrumentTrack.id,
                  devices: instrumentTrack.devices.map(({ id, type }) => ({ id, type })),
              }
            : null;
        routeYeastNoteOffsForTargetTrack(instrumentSnapshot, noteOffs, {
            emitGrandBouleEvent: (deviceId, midiNote) => {
                void eventBus.emit('midi.noteOff', { deviceId, midiNote });
            },
        });
    });
}

export function initWebMidi(): ReturnType<typeof initializeWebMidi> {
    subscribeToTrackSelection();
    subscribeToYeastNotesOff();
    return initializeWebMidi({ onMidiMessage: handleWebMidiMessage });
}
