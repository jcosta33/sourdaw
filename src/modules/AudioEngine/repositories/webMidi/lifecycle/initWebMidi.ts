import { Container } from '#/infra/di/Container';
import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { type MidiInputInfo } from '../../../models/WebMidiTypes';
import { getActiveInput } from '../getActiveInput';
import { getMidiAccess } from '../getMidiAccess';
import { getState } from '../getState';
import { routeYeastNoteOffsForTargetTrack } from '../routeYeastNoteOff';
import { setActiveInput } from '../setActiveInput';
import { setMidiAccess } from '../setMidiAccess';
import { setState } from '../setState';
import { setTargetTrackId } from '../setTargetTrackId';
import { setTauriMode } from '../setTauriMode';
import { WebMidiEventBus } from '../webMidiEventBus';

import { attachInput } from './helpers';
import { selectMidiInputTauri } from './selectMidiInputTauri';

type TauriMidiDevice = { index: number; name: string };
type WebMidiMessageCallback = (event: MIDIMessageEvent) => void;

function enumerateInputs(): MidiInputInfo[] {
    const access = getMidiAccess();
    if (!access) {
        return [];
    }
    const entries = Array.from(access.inputs.values());
    return entries.map((input) => ({
        id: input.id,
        name: input.name ?? 'Unknown Device',
        manufacturer: input.manufacturer ?? 'Unknown',
    }));
}

type OnStateChangeInput = {
    onMidiMessage: WebMidiMessageCallback;
};

function onStateChange({ onMidiMessage }: OnStateChangeInput): void {
    const inputs = enumerateInputs();
    const state = getState();
    const selectedStillExists = inputs.some((index) => index.id === state.selectedInputId);

    const currentInput = getActiveInput();
    if (!selectedStillExists && currentInput) {
        currentInput.onmidimessage = null;
        setActiveInput(null);
    }

    const currentAccess = getMidiAccess();
    if (!selectedStillExists && inputs.length > 0 && currentAccess) {
        const first = inputs[0]!;
        const input = currentAccess.inputs.get(first.id);
        if (input) {
            attachInput({ input, onMidiMessage });
            setState({ inputs, selectedInputId: first.id });
            return;
        }
    }

    setState({
        inputs,
        selectedInputId: selectedStillExists ? state.selectedInputId : null,
    });
}

type InitWebMidiInput = {
    onMidiMessage: WebMidiMessageCallback;
};

export async function initWebMidi({ onMidiMessage }: InitWebMidiInput): Promise<boolean> {
    const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
    const state = getState();

    // Subscribe to trackStore here (once, idempotent guard below) so that
    // whenever selectedTrackId changes — app launch, project load, addTrack,
    // user click — we automatically route MIDI to the correct MIDI track
    // without having to patch every write-site.
    type InitWebMidiWithSub = typeof initWebMidi & { _trackStoreSub?: boolean; _yeastNotesOffSub?: boolean };
    // Route Yeast hung-note offs (mid-playback processor removal) to the live
    // instrument. The Yeast rack emits this app event because it has no
    // instrument downstream of its own; the AudioEngine owns instrument routing,
    // so it subscribes here (once, for the MIDI-routing lifetime) and forwards
    // each off to the current target track's instrument device node.
    if (!(initWebMidi as InitWebMidiWithSub)._yeastNotesOffSub) {
        (initWebMidi as InitWebMidiWithSub)._yeastNotesOffSub = true;
        const eventBus = Container.get(WebMidiEventBus);
        eventBus.on('yeast.notesOff', ({ notes }) => {
            routeYeastNoteOffsForTargetTrack(notes, {
                getTrackStoreState: () => trackStore.value,
                emitGrandBouleEvent: (deviceId, midiNote) => {
                    void eventBus.emit('midi.noteOff', { deviceId, midiNote });
                },
            });
        });
    }
    if (!(initWebMidi as InitWebMidiWithSub)._trackStoreSub) {
        (initWebMidi as InitWebMidiWithSub)._trackStoreSub = true;
        let prevSelectedId: string | null = null;
        trackStore.subscribe((trackState) => {
            const id = trackState?.selectedTrackId ?? null;
            if (id === prevSelectedId) {
                return;
            }
            prevSelectedId = id;
            if (!id) {
                setTargetTrackId(null);
                return;
            }
            const track = trackState?.tracks.find((time) => time.id === id);
            if (track?.kind === 'midi') {
                setTargetTrackId(id);
            }
        });
    }

    if (!state.isSupported) {
        logger.warn('[MIDI] MIDI not supported');
        return false;
    }

    if (webMidiSupported) {
        try {
            const access = await navigator.requestMIDIAccess({ sysex: false });
            setMidiAccess(access);
            access.onstatechange = () => onStateChange({ onMidiMessage });

            const inputs = enumerateInputs();
            setState({ inputs });

            if (inputs.length > 0) {
                // Always (re-)attach: covers first load AND re-init after page
                // navigation where selectedInputId may already be set but
                // the onmidimessage handler was never wired to this access object.
                const targetId = state.selectedInputId ?? inputs[0]!.id;
                const input = access.inputs.get(targetId) ?? access.inputs.get(inputs[0]!.id);
                if (input) {
                    attachInput({ input, onMidiMessage });
                    setState({ selectedInputId: input.id });
                }
            }

            return true;
        } catch (error) {
            logger.warn('[MIDI] Web MIDI failed, trying Tauri fallback:', error);
        }
    }

    if (isTauri()) {
        try {
            setTauriMode(true);
            const devices = (await tauriInvoke('list_midi_inputs')) as TauriMidiDevice[];
            const inputs: MidiInputInfo[] = devices.map((data) => ({
                id: String(data.index),
                name: data.name,
                manufacturer: 'System',
            }));
            setState({ inputs, isSupported: true });

            if (inputs.length > 0) {
                // Always (re-)open: covers first load AND re-init after app
                // restart where selectedInputId is persisted in localStorage but
                // the Tauri IPC port has NOT been opened yet for this session.
                const targetId = state.selectedInputId ?? inputs[0]!.id;
                const targetInput = inputs.find((index) => index.id === targetId) ?? inputs[0]!;
                await selectMidiInputTauri({ portIndex: Number(targetInput.id), onMidiMessage });
                setState({ selectedInputId: targetInput.id });
            }

            return true;
        } catch (error) {
            logger.warn('[MIDI] Tauri MIDI init failed:', error);
            setState({ isSupported: false });
            return false;
        }
    }

    setState({ isSupported: false });
    return false;
}
