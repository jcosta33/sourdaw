import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';
import { type MidiInputInfo } from '#/modules/AudioEngine/models/WebMidiTypes';
import { trackStore } from '#/modules/Arrangement/stores';

import {
    midiAccess,
    activeInput,
    setState,
    getState,
    setMidiAccess,
    setActiveInput,
    setTauriMode,
    setTargetTrackId,
} from '../state';

import { attachInput, selectMidiInputTauri } from './helpers';

type TauriMidiDevice = { index: number; name: string };

function enumerateInputs(): MidiInputInfo[] {
    if (!midiAccess) {
        return [];
    }
    const entries = Array.from(midiAccess.inputs.values());
    return entries.map((input) => ({
        id: input.id,
        name: input.name ?? 'Unknown Device',
        manufacturer: input.manufacturer ?? 'Unknown',
    }));
}

function onStateChange(): void {
    const inputs = enumerateInputs();
    const state = getState();
    const selectedStillExists = inputs.some((i) => i.id === state.selectedInputId);

    if (!selectedStillExists && activeInput) {
        activeInput.onmidimessage = null;
        setActiveInput(null);
    }

    if (!selectedStillExists && inputs.length > 0 && midiAccess) {
        const first = inputs[0]!;
        const input = midiAccess.inputs.get(first.id);
        if (input) {
            attachInput(input);
            setState({ inputs, selectedInputId: first.id });
            return;
        }
    }

    setState({
        inputs,
        selectedInputId: selectedStillExists ? state.selectedInputId : null,
    });
}

const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export async function initWebMidi(): Promise<boolean> {
    const state = getState();

    // Subscribe to trackStore here (once, idempotent guard below) so that
    // whenever selectedTrackId changes — app launch, project load, addTrack,
    // user click — we automatically route MIDI to the correct MIDI track
    // without having to patch every write-site.
    if (!(initWebMidi as unknown as { _trackStoreSub?: boolean })._trackStoreSub) {
        (initWebMidi as unknown as { _trackStoreSub?: boolean })._trackStoreSub = true;
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
            const track = trackState?.tracks.find((t) => t.id === id);
            if (track?.kind === 'midi') {
                setTargetTrackId(id);
            }
        });
    }

    if (!state.isSupported) {
        console.warn('[MIDI] MIDI not supported');
        return false;
    }

    if (webMidiSupported) {
        try {
            const access = await navigator.requestMIDIAccess({ sysex: false });
            setMidiAccess(access);
            access.onstatechange = onStateChange;

            const inputs = enumerateInputs();
            setState({ inputs });

            if (inputs.length > 0) {
                // Always (re-)attach: covers first load AND re-init after page
                // navigation where selectedInputId may already be set but
                // the onmidimessage handler was never wired to this access object.
                const targetId = state.selectedInputId ?? inputs[0]!.id;
                const input = access.inputs.get(targetId) ?? access.inputs.get(inputs[0]!.id);
                if (input) {
                    attachInput(input);
                    setState({ selectedInputId: input.id });
                }
            }

            return true;
        } catch (error) {
            console.warn('[MIDI] Web MIDI failed, trying Tauri fallback:', error);
        }
    }

    if (isTauri()) {
        try {
            setTauriMode(true);
            const devices = (await tauriInvoke('list_midi_inputs')) as TauriMidiDevice[];
            const inputs: MidiInputInfo[] = devices.map((d) => ({
                id: String(d.index),
                name: d.name,
                manufacturer: 'System',
            }));
            setState({ inputs, isSupported: true });

            if (inputs.length > 0) {
                // Always (re-)open: covers first load AND re-init after app
                // restart where selectedInputId is persisted in localStorage but
                // the Tauri IPC port has NOT been opened yet for this session.
                const targetId = state.selectedInputId ?? inputs[0]!.id;
                const targetInput = inputs.find((i) => i.id === targetId) ?? inputs[0]!;
                await selectMidiInputTauri(Number(targetInput.id));
                setState({ selectedInputId: targetInput.id });
            }

            return true;
        } catch (error) {
            console.error('[MIDI] Tauri MIDI init failed:', error);
            setState({ isSupported: false });
            return false;
        }
    }

    setState({ isSupported: false });
    return false;
}