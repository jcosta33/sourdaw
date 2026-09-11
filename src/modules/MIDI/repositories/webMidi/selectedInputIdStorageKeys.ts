/**
 * Storage keys for the persisted MIDI input preference, namespaced per
 * port-identity scheme.
 *
 * A Web MIDI id (`MIDIAccess` device ids) and a native port id (CoreMIDI
 * unique ids, WinMM device paths, ALSA name/ordinal fallbacks — #2016) are
 * strings from unrelated namespaces. They shared one untagged key until
 * #4138, so a transport flip between sessions resolved an id from the wrong
 * scheme: at best a silent fall back to enumeration order, at worst — with
 * all-digit CoreMIDI ids — a collision onto the wrong transport.
 */

/** Ids minted by the browser `MIDIAccess` transport. */
export const WEB_MIDI_IDENTITY_SCHEME = 'web-midi';
/** Ids minted by the native MIDI bridge (see #2016). */
export const NATIVE_IDENTITY_SCHEME = 'native';

export type MidiIdentityScheme = typeof WEB_MIDI_IDENTITY_SCHEME | typeof NATIVE_IDENTITY_SCHEME;

/**
 * Pre-#4138 key shared by both schemes. It records nothing about which scheme
 * produced its value, so it is only ever a migration fallback on read and is
 * retired by the next persist, whichever scheme makes it.
 */
export const LEGACY_SELECTED_INPUT_ID_STORAGE_KEY = 'sourdaw:midi:selectedInputId';

const SELECTED_INPUT_ID_STORAGE_KEY_PREFIX = 'sourdaw:midi:selectedInputId';

/** The scheme-namespaced key holding the input preference of one scheme. */
export function selectedInputIdStorageKey(scheme: MidiIdentityScheme): string {
    return `${SELECTED_INPUT_ID_STORAGE_KEY_PREFIX}:${scheme}`;
}
