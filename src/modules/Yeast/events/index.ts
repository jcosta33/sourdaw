/**
 * Yeast public event payloads.
 *
 * `yeast.notesOff` carries the originating track and channel-complete Note Off identities a Yeast rack mutation left
 * hanging — emitted when a processor is removed mid-playback so the AudioEngine
 * can deliver them to the live instrument (the rack computes the offs but has no
 * downstream of its own; without this they would be discarded and the note would
 * hang). The payload carries plain channel/note identities, not the internal `MidiEvent`
 * model, so the app event surface stays free of Yeast implementation types.
 */
export type { YeastNoteOffIdentity, YeastNotesOffPayload } from './YeastNotesOffPayload';
