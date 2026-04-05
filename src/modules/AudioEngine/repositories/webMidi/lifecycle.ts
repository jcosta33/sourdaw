/**
 * Web MIDI lifecycle: init, device selection, hot-plug, Tauri fallback, destroy.
 */
import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';
import { type MidiInputInfo, MIDI_CC } from '#/modules/AudioEngine/models/WebMidiTypes';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import {
    midiAccess,
    activeInput,
    tauriMode,
    tauriEventUnlisten,
    activeNotes,
    channelToNote,
    midiLearn,
    setState,
    getState,
    setMidiAccess,
    setActiveInput,
    setTauriMode,
    setTauriEventUnlisten,
    setTargetTrackId,
    setMpeEnabledInternal,
    getMpeEnabledInternal,
} from './state';
import { onMidiMessage } from './messageHandlers';
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';

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

function attachInput(input: MIDIInput): void {
    if (activeInput && activeInput !== input) {
        activeInput.removeEventListener('midimessage', onMidiMessage as EventListener);
    }
    setActiveInput(input);
    input.addEventListener('midimessage', onMidiMessage as EventListener);
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

async function selectMidiInputTauri(portIndex: number): Promise<void> {
    if (tauriEventUnlisten) {
        tauriEventUnlisten();
        setTauriEventUnlisten(null);
    }

    const portName = (await tauriInvoke('open_midi_input', { portIndex })) as string;
    void portName;

    const { tauriListen } = await import('#/helpers/tauriBridge');
    const unlisten = (await tauriListen('midi-message', (event) => {
        const payload = event as { payload: { data: number[] } };
        const bytes = payload.payload.data;
        if (!bytes || bytes.length < 2) {
            return;
        }
        const uint8 = new Uint8Array(bytes);
        onMidiMessage({ data: uint8 } as MIDIMessageEvent);
    })) as unknown as () => void;
    setTauriEventUnlisten(unlisten);
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

export function selectMidiInput(deviceId: string): void {
    if (tauriMode) {
        void selectMidiInputTauri(Number(deviceId));
        setState({ selectedInputId: deviceId });
        return;
    }

    if (!midiAccess) {
        return;
    }

    const input = midiAccess.inputs.get(deviceId);
    if (!input) {
        return;
    }

    attachInput(input);
    setState({ selectedInputId: deviceId });
}

export function getAvailableMidiInputs(): MidiInputInfo[] {
    return getState().inputs;
}

export function setMidiInputTrack(trackId: string): void {
    setTargetTrackId(trackId);
}

export function setMpeEnabled(enabled: boolean): void {
    setMpeEnabledInternal(enabled);
}

export function getMpeEnabled(): boolean {
    return getMpeEnabledInternal();
}

export function startMidiLearnLegacy(callback: (cc: number, channel: number) => void): void {
    midiLearn.active = true;
    midiLearn.callback = callback;
}

export function stopMidiLearnLegacy(): void {
    midiLearn.active = false;
    midiLearn.callback = null;
}

export function resetMidiState(): void {
    for (const [note, noteData] of activeNotes) {
        if (noteData.osc) {
            const now = audioEngine.context.currentTime;
            if (noteData.osc._env) {
                noteData.osc._env.gain.setTargetAtTime(0, now, 0.005);
            }
            try {
                noteData.osc.stop(now + 0.02);
            } catch {
                // already stopped
            }
        }
        void note;
    }
    activeNotes.clear();
    channelToNote.clear();

    if (activeInput && midiAccess) {
        const output = midiAccess.outputs.values().next().value;
        if (output) {
            for (let ch = 0; ch < 16; ch++) {
                output.send([MIDI_CC | ch, 120, 0]);
                output.send([MIDI_CC | ch, 121, 0]);
            }
        }
    }
}

export function destroyWebMidi(): void {
    if (activeInput) {
        activeInput.onmidimessage = null;
        setActiveInput(null);
    }

    if (tauriMode) {
        if (tauriEventUnlisten) {
            tauriEventUnlisten();
            setTauriEventUnlisten(null);
        }
        void tauriInvoke('close_midi_input').catch(() => {});
        setTauriMode(false);
    }

    for (const noteData of activeNotes.values()) {
        if (noteData.osc) {
            try {
                noteData.osc.stop();
            } catch {
                // already stopped
            }
        }
    }
    activeNotes.clear();
    channelToNote.clear();

    if (midiAccess) {
        midiAccess.onstatechange = null;
        setMidiAccess(null);
    }

    midiLearn.active = false;
    midiLearn.callback = null;
    setTargetTrackId(null);

    setState({
        inputs: [],
        selectedInputId: null,
    });
}
