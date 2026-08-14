import { Container } from '#/infra/di/Container';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine } from '#/modules/AudioEngine/useCases';

import { initWebMidi as initializeWebMidi } from '../../repositories/webMidi/lifecycle/initWebMidi';
import { routeYeastNoteOffsForTargetTrack } from '../../repositories/webMidi/routeYeastNoteOff';
import { WebMidiEventBus } from '../../repositories/webMidi/webMidiEventBus';

import { disposeWebMidiSubscriptions } from './disposeWebMidiSubscriptions';
import { getMidiInputTrackOwnerId } from './getMidiInputTrackOwnerId';
import { handleWebMidiMessage } from './handleWebMidiMessage';
import { resolveInstrumentTrack } from './resolveInstrumentTrack';
import { setMidiInputTrack } from './setMidiInputTrack';
import { webMidiSubscriptionState } from './webMidiSubscriptionState';

function subscribeToTrackSelection(): void {
    if (webMidiSubscriptionState.disposeTrackStoreSubscription) {
        return;
    }

    let previousSelectedId: string | null = null;
    webMidiSubscriptionState.disposeTrackStoreSubscription = trackStore.subscribe((trackState) => {
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
            return;
        }
        // Selecting an audio track — or a track id that is not in the store —
        // must drop the live input target too. Leaving the previous MIDI track
        // armed keeps the controller playing an instrument the user can no
        // longer see selected, and keeps recording into it.
        //
        // Unless something claimed the route explicitly: `armTrack` passes an
        // owner id, and in every DAW that ships this, record-arm outranks
        // selection. Clearing an armed route because the user clicked an audio
        // track's fader would kill the controller mid-take, and `armTrack`'s
        // `ownsRuntimeRoute` check would no longer recognise the route it set,
        // so un-arming could not tear it down cleanly either.
        if (getMidiInputTrackOwnerId() !== null) {
            return;
        }
        setMidiInputTrack(null);
    });
}

function subscribeToYeastNotesOff(): void {
    if (webMidiSubscriptionState.disposeYeastNotesOffSubscription) {
        return;
    }

    const eventBus = Container.get(WebMidiEventBus);
    webMidiSubscriptionState.disposeYeastNotesOffSubscription = eventBus.on(
        'yeast.notesOff',
        ({ trackId, noteOffs }) => {
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
                getTrackStrip: (trackId) => audioEngine.getTrackStrip(trackId),
            });
        }
    );
}

export function initWebMidi(): ReturnType<typeof initializeWebMidi> {
    subscribeToTrackSelection();
    subscribeToYeastNotesOff();
    return initializeWebMidi({ onMidiMessage: handleWebMidiMessage });
}

import.meta.hot?.dispose(() => {
    disposeWebMidiSubscriptions();
});
