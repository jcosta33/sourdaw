import { Container } from '#/infra/di/Container';
import { trackStore } from '#/modules/Arrangement/stores';
import { audioEngine } from '#/modules/AudioEngine/useCases';

import { initWebMidi as initializeWebMidi } from '../../repositories/webMidi/lifecycle/initWebMidi';
import { releaseHeldYeastVoices } from '../../repositories/webMidi/releaseCapturedYeastVoices';
import { releaseCapturedYeastLifecycleVoices } from '../../repositories/webMidi/routeYeastLifecycleNoteOff';
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
    // A rack topology change ends the notes the rack had sounding on its
    // instrument track (the live route's track id). Each off ends the voices
    // the rack's note-ons started, on the device and pad they sound on;
    // forced offs carry no release-velocity byte and sound at once.
    webMidiSubscriptionState.disposeYeastNotesOffSubscription = eventBus.on(
        'yeast.notesOff',
        ({ trackId, noteOffs }) => {
            // Lifecycle offs name the voice that started them (#4873): release
            // the captured owner first so the ORIGINAL instrument control
            // settles its voice even after the track's instrument changed, and
            // a same-pitch successor on the replacement stays untouched.
            // Only what no captured owner claims falls through to the
            // current-node route.
            const unroutedNoteOffs = releaseCapturedYeastLifecycleVoices(trackId, noteOffs);
            // A held key's own transformed voices live on its active note, not
            // the route registry, so the lifecycle release never sees them;
            // end them at each off's pitch.
            for (const { channel, note } of noteOffs) {
                releaseHeldYeastVoices(trackId, channel, note);
            }
            if (unroutedNoteOffs.length === 0) {
                return;
            }
            const resolvedInstrument = resolveInstrumentTrack(trackStore.value, trackId);
            const instrumentTrack = resolvedInstrument?.instrumentTrack;
            const instrumentSnapshot = instrumentTrack
                ? {
                      id: instrumentTrack.id,
                      devices: instrumentTrack.devices.map(({ id, type }) => ({ id, type })),
                  }
                : null;
            routeYeastNoteOffsForTargetTrack(instrumentSnapshot, unroutedNoteOffs, {
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
    return initializeWebMidi({
        onMidiMessage: (event) => {
            void handleWebMidiMessage(event);
        },
    });
}

import.meta.hot?.dispose(() => {
    disposeWebMidiSubscriptions();
});
