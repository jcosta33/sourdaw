import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime } from '#/utils/desktopBridge';

import { type MidiInputInfo, type WebMidiInputMessage } from '../../../models/WebMidiTypes';
import { getMidiAccess } from '../getMidiAccess';
import { getState } from '../getState';
import { readPersistedInputId } from '../readPersistedInputId';
import { setMidiAccess } from '../setMidiAccess';
import { setNativeMode } from '../setNativeMode';
import { setState } from '../setState';
// Side-effect: registers the store sync subscription before any setState below.
import '../store';

import { detachActiveInput } from './detachActiveInput';
import { attachInput } from './helpers';
import { listNativeMidiInputs } from './listNativeMidiInputs';
import { resolveNativeMidiPort } from './resolveNativeMidiPort';
import { selectMidiInputNative } from './selectMidiInputNative';

type WebMidiMessageCallback = (event: WebMidiInputMessage) => void;

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
    const currentAccess = getMidiAccess();
    const preferredId = readPersistedInputId();

    // The saved device came back (replug, hub power cycle). Restore it rather
    // than leaving the session stuck on whatever stood in for it.
    if (preferredId !== null && preferredId !== state.selectedInputId && currentAccess) {
        const preferredInput = currentAccess.inputs.get(preferredId);
        if (preferredInput && inputs.some((entry) => entry.id === preferredId)) {
            detachActiveInput();
            attachInput({ input: preferredInput, onMidiMessage });
            setState({ inputs, selectedInputId: preferredId });
            return;
        }
    }

    const selectedStillExists = inputs.some((index) => index.id === state.selectedInputId);

    if (!selectedStillExists) {
        detachActiveInput();
    }

    if (!selectedStillExists && inputs.length > 0 && currentAccess) {
        const first = inputs[0]!;
        const input = currentAccess.inputs.get(first.id);
        if (input) {
            attachInput({ input, onMidiMessage });
            // Session-only stand-in: the user still prefers the device that
            // was unplugged, so leave the persisted preference alone.
            setState({ inputs, selectedInputId: first.id }, { persistSelection: false });
            return;
        }
    }

    setState(
        {
            inputs,
            selectedInputId: selectedStillExists ? state.selectedInputId : null,
        },
        { persistSelection: false }
    );
}

type InitWebMidiInput = {
    onMidiMessage: WebMidiMessageCallback;
};

export async function initWebMidi({ onMidiMessage }: InitWebMidiInput): Promise<boolean> {
    const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
    const state = getState();

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
                //
                // The saved preference outranks live session state here: the
                // live id can be a stand-in from an earlier init that fell back
                // while the preferred device was unplugged, and resolving from
                // it would adopt the stand-in as the target on every init after
                // the first.
                const targetId = readPersistedInputId() ?? state.selectedInputId ?? inputs[0]!.id;
                const input = access.inputs.get(targetId) ?? access.inputs.get(inputs[0]!.id);
                if (input) {
                    attachInput({ input, onMidiMessage });
                    // Never persist from init. Only an explicit selection is a
                    // user choice; whatever init resolves — the saved device or
                    // a session stand-in for it — is already remembered or must
                    // not be.
                    setState({ selectedInputId: input.id }, { persistSelection: false });
                }
            }

            return true;
        } catch (error) {
            logger.warn('[MIDI] Web MIDI failed, trying native fallback:', error);
        }
    }

    if (isDesktopRuntime()) {
        try {
            setNativeMode(true);
            const ports = await listNativeMidiInputs();
            const inputs: MidiInputInfo[] = ports.map((port) => ({
                id: port.id,
                name: port.name,
                manufacturer: 'System',
            }));
            setState({ inputs, isSupported: true });

            if (ports.length > 0) {
                // Always (re-)open: covers first load AND re-init after app
                // restart where selectedInputId is persisted in localStorage but
                // the native IPC port has NOT been opened yet for this session.
                //
                // Saved preference first, for the same reason as the Web MIDI
                // branch: live state can hold an earlier init's stand-in.
                const targetId = readPersistedInputId() ?? state.selectedInputId ?? ports[0]!.id;
                // A saved id matching no present port is absent, whether the
                // device is unplugged or the id predates stable identity and is
                // still a bare enumeration index. Either way it resolves to
                // nothing rather than to whoever holds that slot now.
                const targetPort = resolveNativeMidiPort(ports, targetId) ?? ports[0]!;
                try {
                    await selectMidiInputNative({
                        portIndex: targetPort.portIndex,
                        portName: targetPort.name,
                        onMidiMessage,
                    });
                    // Never persist from init — same rule as the Web MIDI path.
                    setState({ selectedInputId: targetPort.id }, { persistSelection: false });
                } catch (error) {
                    // The enumeration succeeded and is already published; one
                    // port that refused to open must not take the whole MIDI
                    // surface down with it.
                    logger.warn('[MIDI] Failed to open startup MIDI input:', error);
                }
            }

            return true;
        } catch (error) {
            logger.warn('[MIDI] Native MIDI init failed:', error);
            setState({ isSupported: false });
            return false;
        }
    }

    setState({ isSupported: false });
    return false;
}
