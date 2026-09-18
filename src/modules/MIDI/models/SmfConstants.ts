/**
 * Standard MIDI File wire constants: the status bytes and meta-event ids the
 * exporter writes and the import worker decodes. The worker is a separately
 * bundled realm and restates these with pointer comments (see
 * `workers/midiImportWorker.ts`); a parity spec pins the two spellings equal.
 */

/** Channel-voice status: note on (velocity 0 doubles as note off on receive). */
export const SMF_NOTE_ON_STATUS = 0x90;

/** Channel-voice status: note off. */
export const SMF_NOTE_OFF_STATUS = 0x80;

/** Channel-voice status: control change. */
export const SMF_CONTROL_CHANGE_STATUS = 0xb0;

/** Meta-event marker byte (followed by a meta-event type byte). */
export const SMF_META_EVENT = 0xff;

/** Meta-event type: track name. */
export const SMF_META_TRACK_NAME = 0x03;

/** Meta-event type: end of track (always with a zero-length payload). */
export const SMF_META_END_OF_TRACK = 0x2f;

/** Meta-event type: set tempo (microseconds per quarter note). */
export const SMF_META_SET_TEMPO = 0x51;

/** Filename extension a downloaded MIDI file carries. */
export const MIDI_FILE_EXTENSION = '.mid';

/** MIME type a downloaded MIDI file is served as. */
export const MIDI_FILE_MIME_TYPE = 'audio/midi';
