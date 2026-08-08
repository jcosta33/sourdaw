export type PushMidiBytes = readonly number[] | Uint8Array;

export type PushMidiInputEvent =
    | Readonly<{
          kind: 'pad';
          note: number;
          edge: 'pressed' | 'released';
          velocity: number;
      }>
    | Readonly<{
          kind: 'poly-pressure';
          note: number;
          pressure: number;
      }>
    | Readonly<{
          kind: 'channel-pressure';
          pressure: number;
      }>
    | Readonly<{
          kind: 'encoder-turn';
          control: number;
          delta: number;
      }>
    | Readonly<{
          kind: 'touch';
          note: number;
          edge: 'touched' | 'released';
      }>
    | Readonly<{
          kind: 'button';
          control: number;
          edge: 'pressed' | 'released';
      }>
    | Readonly<{
          kind: 'touch-strip-pitch-bend';
          value: number;
      }>;

export type PushMidiIdentityReply = Readonly<{
    kind: 'identity';
    firmware: Readonly<{
        major: number;
        minor: number;
        build: number;
    }>;
    serialNumber: number;
    boardRevision: number;
}>;

export type PushMidiModeReply = Readonly<{
    kind: 'midi-mode';
    mode: number;
}>;

export type PushMidiReply = PushMidiIdentityReply | PushMidiModeReply;

export type PushMidiDecodeRejectionReason =
    | 'invalid-length'
    | 'invalid-byte'
    | 'invalid-data-byte'
    | 'invalid-value'
    | 'unsupported-status'
    | 'unsupported-channel'
    | 'unsupported-note'
    | 'unsupported-control'
    | 'unsupported-identity'
    | 'reserved-message'
    | 'zero-relative-movement';

export type PushMidiDecodeResult =
    | Readonly<{
          status: 'event';
          event: PushMidiInputEvent;
      }>
    | Readonly<{
          status: 'reply';
          reply: PushMidiReply;
      }>
    | Readonly<{
          status: 'rejected';
          reason: PushMidiDecodeRejectionReason;
      }>;

export type PushMidiOutputCommand =
    | Readonly<{
          kind: 'pad-led';
          note: number;
          paletteIndex: number;
      }>
    | Readonly<{
          kind: 'button-led';
          control: number;
          paletteIndex: number;
      }>
    | Readonly<{
          kind: 'aftertouch-mode';
          mode: number;
      }>;

export type PushMidiEncodeResult =
    | Readonly<{
          status: 'encoded';
          bytes: Uint8Array;
      }>
    | Readonly<{
          status: 'rejected';
          reason: 'invalid-value' | 'unsupported-note' | 'unsupported-control';
      }>;

export type PushMidiReplyRequest =
    | Readonly<{
          kind: 'identity';
      }>
    | Readonly<{
          kind: 'midi-mode';
          mode: number;
      }>;

export type PushMidiBeginRequestResult =
    | Readonly<{
          status: 'started';
          bytes: Uint8Array;
      }>
    | Readonly<{
          status: 'rejected';
          reason: 'invalid-value' | 'reply-pending';
      }>;

export type PushMidiAcceptReplyResult =
    | Readonly<{
          status: 'accepted';
          reply: PushMidiReply;
      }>
    | Readonly<{
          status: 'rejected';
          reason: PushMidiDecodeRejectionReason | 'not-a-reply' | 'reply-mismatch' | 'unsolicited-reply';
      }>;

export type PushMidiCodec = Readonly<{
    decode(bytes: PushMidiBytes): PushMidiDecodeResult;
    encode(command: PushMidiOutputCommand): PushMidiEncodeResult;
    beginRequest(request: PushMidiReplyRequest): PushMidiBeginRequestResult;
    acceptReply(bytes: PushMidiBytes): PushMidiAcceptReplyResult;
}>;

type PendingReply =
    | Readonly<{
          kind: 'identity';
      }>
    | Readonly<{
          kind: 'midi-mode';
          mode: number;
      }>;

const PAD_NOTE_MINIMUM = 36;
const PAD_NOTE_MAXIMUM = 99;
const MIDI_DATA_MAXIMUM = 127;
const SERIAL_HIGH_BYTE_MAXIMUM = 15;

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const POLY_PRESSURE = 0xa0;
const CONTROL_CHANGE = 0xb0;
const CHANNEL_PRESSURE = 0xd0;
const PITCH_BEND = 0xe0;
const SYSTEM_MESSAGE = 0xf0;

const PUSH_VENDOR_PREFIX = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01] as const;
const MIDI_MODE_COMMAND = 0x0a;
const AFTERTOUCH_MODE_COMMAND = 0x1e;
const IDENTITY_REQUEST = [0xf0, 0x7e, 0x01, 0x06, 0x01, 0xf7] as const;
const IDENTITY_REPLY_PREFIX = [0xf0, 0x7e, 0x01, 0x06, 0x02] as const;
const ABLETON_MANUFACTURER = [0x00, 0x21, 0x1d] as const;
const PUSH_FAMILY = [0x67, 0x32] as const;
const PUSH_2_MEMBER = [0x02, 0x00] as const;
const IDENTITY_REPLY_LENGTH = 23;
const VENDOR_MODE_MESSAGE_LENGTH = 9;

function rejected(reason: PushMidiDecodeRejectionReason): PushMidiDecodeResult {
    return {
        status: 'rejected',
        reason,
    };
}

function isIntegerInRange(value: number, minimum: number, maximum: number): boolean {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function byteAt(bytes: PushMidiBytes, index: number): number {
    const value = bytes[index];
    if (value === undefined) {
        return 0;
    }
    return value;
}

function invalidByteReason(bytes: PushMidiBytes): 'invalid-byte' | undefined {
    for (let index = 0; index < bytes.length; index += 1) {
        const value = bytes[index];
        if (value === undefined || !isIntegerInRange(value, 0, 0xff)) {
            return 'invalid-byte';
        }
    }
    return undefined;
}

function hasOnlyDataBytes(bytes: PushMidiBytes, startIndex: number, endIndex: number): boolean {
    for (let index = startIndex; index < endIndex; index += 1) {
        if (byteAt(bytes, index) > MIDI_DATA_MAXIMUM) {
            return false;
        }
    }
    return true;
}

function matchesAt(bytes: PushMidiBytes, expected: readonly number[], offset = 0): boolean {
    if (bytes.length < offset + expected.length) {
        return false;
    }

    for (let index = 0; index < expected.length; index += 1) {
        if (byteAt(bytes, offset + index) !== expected[index]) {
            return false;
        }
    }
    return true;
}

function isPadNote(note: number): boolean {
    return isIntegerInRange(note, PAD_NOTE_MINIMUM, PAD_NOTE_MAXIMUM);
}

function isEncoderControl(control: number): boolean {
    if (control === 14 || control === 15) {
        return true;
    }
    return control >= 71 && control <= 79;
}

function isTouchSensorNote(note: number): boolean {
    if (note >= 0 && note <= 10) {
        return true;
    }
    return note === 12;
}

function isDocumentedButton(control: number): boolean {
    if (!Number.isInteger(control)) {
        return false;
    }
    if (control === 3 || control === 9) {
        return true;
    }
    if (control >= 20 && control <= 31) {
        return true;
    }
    if (control >= 35 && control <= 63) {
        return true;
    }
    if (control >= 85 && control <= 90) {
        return true;
    }
    if (control >= 102 && control <= 113) {
        return true;
    }
    return control >= 116 && control <= 119;
}

function decodeIdentityReply(bytes: PushMidiBytes): PushMidiDecodeResult {
    if (bytes.length !== IDENTITY_REPLY_LENGTH) {
        return rejected('invalid-length');
    }
    if (byteAt(bytes, IDENTITY_REPLY_LENGTH - 1) !== 0xf7) {
        return rejected('invalid-value');
    }
    if (!hasOnlyDataBytes(bytes, 1, IDENTITY_REPLY_LENGTH - 1)) {
        return rejected('invalid-data-byte');
    }
    if (!matchesAt(bytes, ABLETON_MANUFACTURER, 5)) {
        return rejected('unsupported-identity');
    }
    if (!matchesAt(bytes, PUSH_FAMILY, 8)) {
        return rejected('unsupported-identity');
    }
    if (!matchesAt(bytes, PUSH_2_MEMBER, 10)) {
        return rejected('unsupported-identity');
    }

    const serialHighByte = byteAt(bytes, 20);
    if (serialHighByte > SERIAL_HIGH_BYTE_MAXIMUM) {
        return rejected('invalid-value');
    }

    const build = byteAt(bytes, 14) + byteAt(bytes, 15) * 128;
    const serialNumber =
        byteAt(bytes, 16) +
        byteAt(bytes, 17) * 128 +
        byteAt(bytes, 18) * 16_384 +
        byteAt(bytes, 19) * 2_097_152 +
        serialHighByte * 268_435_456;

    return {
        status: 'reply',
        reply: {
            kind: 'identity',
            firmware: {
                major: byteAt(bytes, 12),
                minor: byteAt(bytes, 13),
                build,
            },
            serialNumber,
            boardRevision: byteAt(bytes, 21),
        },
    };
}

function decodeMidiModeReply(bytes: PushMidiBytes): PushMidiDecodeResult {
    if (bytes.length !== VENDOR_MODE_MESSAGE_LENGTH) {
        return rejected('invalid-length');
    }
    if (byteAt(bytes, VENDOR_MODE_MESSAGE_LENGTH - 1) !== 0xf7) {
        return rejected('invalid-value');
    }
    if (!hasOnlyDataBytes(bytes, 1, VENDOR_MODE_MESSAGE_LENGTH - 1)) {
        return rejected('invalid-data-byte');
    }

    const mode = byteAt(bytes, 7);
    if (!isIntegerInRange(mode, 0, 2)) {
        return rejected('invalid-value');
    }

    return {
        status: 'reply',
        reply: {
            kind: 'midi-mode',
            mode,
        },
    };
}

function decodeSystemMessage(bytes: PushMidiBytes): PushMidiDecodeResult {
    if (matchesAt(bytes, IDENTITY_REPLY_PREFIX)) {
        return decodeIdentityReply(bytes);
    }
    if (matchesAt(bytes, PUSH_VENDOR_PREFIX) && byteAt(bytes, 6) === MIDI_MODE_COMMAND) {
        return decodeMidiModeReply(bytes);
    }
    return rejected('reserved-message');
}

function decodeNoteOff(bytes: PushMidiBytes): PushMidiDecodeResult {
    const note = byteAt(bytes, 1);
    const velocity = byteAt(bytes, 2);
    if (!isPadNote(note)) {
        return rejected('unsupported-note');
    }
    if (velocity !== 0) {
        return rejected('invalid-value');
    }

    return {
        status: 'event',
        event: {
            kind: 'pad',
            note,
            edge: 'released',
            velocity,
        },
    };
}

function decodeNoteOn(bytes: PushMidiBytes): PushMidiDecodeResult {
    const note = byteAt(bytes, 1);
    const velocity = byteAt(bytes, 2);

    if (isPadNote(note)) {
        if (velocity === 0) {
            return {
                status: 'event',
                event: {
                    kind: 'pad',
                    note,
                    edge: 'released',
                    velocity,
                },
            };
        }
        return {
            status: 'event',
            event: {
                kind: 'pad',
                note,
                edge: 'pressed',
                velocity,
            },
        };
    }

    if (!isTouchSensorNote(note)) {
        return rejected('unsupported-note');
    }
    if (velocity !== 0 && velocity !== 127) {
        return rejected('invalid-value');
    }

    let edge: 'touched' | 'released' = 'released';
    if (velocity === 127) {
        edge = 'touched';
    }
    return {
        status: 'event',
        event: {
            kind: 'touch',
            note,
            edge,
        },
    };
}

function decodePolyPressure(bytes: PushMidiBytes): PushMidiDecodeResult {
    const note = byteAt(bytes, 1);
    const pressure = byteAt(bytes, 2);
    if (!isPadNote(note)) {
        return rejected('unsupported-note');
    }
    if (pressure === 0) {
        return rejected('invalid-value');
    }

    return {
        status: 'event',
        event: {
            kind: 'poly-pressure',
            note,
            pressure,
        },
    };
}

function decodeControlChange(bytes: PushMidiBytes): PushMidiDecodeResult {
    const control = byteAt(bytes, 1);
    const value = byteAt(bytes, 2);

    if (isEncoderControl(control)) {
        if (value === 0) {
            return rejected('zero-relative-movement');
        }

        let delta = value;
        if (value >= 64) {
            delta = value - 128;
        }
        return {
            status: 'event',
            event: {
                kind: 'encoder-turn',
                control,
                delta,
            },
        };
    }

    if (!isDocumentedButton(control)) {
        return rejected('unsupported-control');
    }
    if (value !== 0 && value !== 127) {
        return rejected('invalid-value');
    }

    let edge: 'pressed' | 'released' = 'released';
    if (value === 127) {
        edge = 'pressed';
    }
    return {
        status: 'event',
        event: {
            kind: 'button',
            control,
            edge,
        },
    };
}

function decodeChannelPressure(bytes: PushMidiBytes): PushMidiDecodeResult {
    return {
        status: 'event',
        event: {
            kind: 'channel-pressure',
            pressure: byteAt(bytes, 1),
        },
    };
}

function decodePitchBend(bytes: PushMidiBytes): PushMidiDecodeResult {
    const lower = byteAt(bytes, 1);
    if ((lower & 0x3f) !== 0) {
        return rejected('invalid-value');
    }

    return {
        status: 'event',
        event: {
            kind: 'touch-strip-pitch-bend',
            value: lower + byteAt(bytes, 2) * 128,
        },
    };
}

function expectedChannelMessageLength(messageType: number): number | undefined {
    if (messageType === CHANNEL_PRESSURE) {
        return 2;
    }
    if (
        messageType === NOTE_OFF ||
        messageType === NOTE_ON ||
        messageType === POLY_PRESSURE ||
        messageType === CONTROL_CHANGE ||
        messageType === PITCH_BEND
    ) {
        return 3;
    }
    return undefined;
}

function decodeChannelMessage(bytes: PushMidiBytes, status: number): PushMidiDecodeResult {
    const messageType = status & 0xf0;
    const expectedLength = expectedChannelMessageLength(messageType);
    if (expectedLength === undefined) {
        return rejected('unsupported-status');
    }
    if ((status & 0x0f) !== 0) {
        return rejected('unsupported-channel');
    }
    if (bytes.length !== expectedLength) {
        return rejected('invalid-length');
    }
    if (!hasOnlyDataBytes(bytes, 1, bytes.length)) {
        return rejected('invalid-data-byte');
    }

    if (messageType === NOTE_OFF) {
        return decodeNoteOff(bytes);
    }
    if (messageType === NOTE_ON) {
        return decodeNoteOn(bytes);
    }
    if (messageType === POLY_PRESSURE) {
        return decodePolyPressure(bytes);
    }
    if (messageType === CONTROL_CHANGE) {
        return decodeControlChange(bytes);
    }
    if (messageType === CHANNEL_PRESSURE) {
        return decodeChannelPressure(bytes);
    }
    return decodePitchBend(bytes);
}

function decode(bytes: PushMidiBytes): PushMidiDecodeResult {
    if (bytes.length === 0) {
        return rejected('invalid-length');
    }

    const byteReason = invalidByteReason(bytes);
    if (byteReason) {
        return rejected(byteReason);
    }

    const status = byteAt(bytes, 0);
    if (status === SYSTEM_MESSAGE) {
        return decodeSystemMessage(bytes);
    }
    if (status >= SYSTEM_MESSAGE) {
        return rejected('reserved-message');
    }
    return decodeChannelMessage(bytes, status);
}

function encoded(bytes: readonly number[]): PushMidiEncodeResult {
    return {
        status: 'encoded',
        bytes: new Uint8Array(bytes),
    };
}

function encode(command: PushMidiOutputCommand): PushMidiEncodeResult {
    if (command.kind === 'pad-led') {
        if (!isPadNote(command.note)) {
            return {
                status: 'rejected',
                reason: 'unsupported-note',
            };
        }
        if (!isIntegerInRange(command.paletteIndex, 0, MIDI_DATA_MAXIMUM)) {
            return {
                status: 'rejected',
                reason: 'invalid-value',
            };
        }
        return encoded([NOTE_ON, command.note, command.paletteIndex]);
    }

    if (command.kind === 'button-led') {
        if (!isDocumentedButton(command.control)) {
            return {
                status: 'rejected',
                reason: 'unsupported-control',
            };
        }
        if (!isIntegerInRange(command.paletteIndex, 0, MIDI_DATA_MAXIMUM)) {
            return {
                status: 'rejected',
                reason: 'invalid-value',
            };
        }
        return encoded([CONTROL_CHANGE, command.control, command.paletteIndex]);
    }

    if (!isIntegerInRange(command.mode, 0, 1)) {
        return {
            status: 'rejected',
            reason: 'invalid-value',
        };
    }
    return encoded([...PUSH_VENDOR_PREFIX, AFTERTOUCH_MODE_COMMAND, command.mode, 0xf7]);
}

function started(bytes: readonly number[]): PushMidiBeginRequestResult {
    return {
        status: 'started',
        bytes: new Uint8Array(bytes),
    };
}

function pendingMatchesReply(pending: PendingReply, reply: PushMidiReply): boolean {
    if (pending.kind !== reply.kind) {
        return false;
    }
    if (pending.kind === 'identity') {
        return true;
    }
    if (reply.kind !== 'midi-mode') {
        return false;
    }
    return pending.mode === reply.mode;
}

export function createPushMidiCodec(): PushMidiCodec {
    let pendingReply: PendingReply | undefined;

    function beginRequest(request: PushMidiReplyRequest): PushMidiBeginRequestResult {
        if (pendingReply) {
            return {
                status: 'rejected',
                reason: 'reply-pending',
            };
        }

        if (request.kind === 'identity') {
            pendingReply = {
                kind: 'identity',
            };
            return started(IDENTITY_REQUEST);
        }

        if (!isIntegerInRange(request.mode, 0, 2)) {
            return {
                status: 'rejected',
                reason: 'invalid-value',
            };
        }

        pendingReply = {
            kind: 'midi-mode',
            mode: request.mode,
        };
        return started([...PUSH_VENDOR_PREFIX, MIDI_MODE_COMMAND, request.mode, 0xf7]);
    }

    function acceptReply(bytes: PushMidiBytes): PushMidiAcceptReplyResult {
        const decoded = decode(bytes);
        if (decoded.status === 'rejected') {
            return decoded;
        }
        if (decoded.status === 'event') {
            return {
                status: 'rejected',
                reason: 'not-a-reply',
            };
        }
        if (!pendingReply) {
            return {
                status: 'rejected',
                reason: 'unsolicited-reply',
            };
        }
        if (!pendingMatchesReply(pendingReply, decoded.reply)) {
            return {
                status: 'rejected',
                reason: 'reply-mismatch',
            };
        }

        pendingReply = undefined;
        return {
            status: 'accepted',
            reply: decoded.reply,
        };
    }

    return Object.freeze({
        decode,
        encode,
        beginRequest,
        acceptReply,
    });
}
