import { describe, expect, it } from 'vitest';

import {
    createPushMidiCodec,
    type PushMidiBeginRequestResult,
    type PushMidiDecodeResult,
    type PushMidiInputEvent,
} from '../pushMidiCodec';

const IDENTITY_REPLY = [
    0xf0, 0x7e, 0x01, 0x06, 0x02, 0x00, 0x21, 0x1d, 0x67, 0x32, 0x02, 0x00, 0x01, 0x00, 0x2f, 0x00, 0x73, 0x4d, 0x1f,
    0x08, 0x00, 0x01, 0xf7,
] as const;

const DOCUMENTED_ENCODERS = [14, 15, 71, 72, 73, 74, 75, 76, 77, 78, 79] as const;
const DOCUMENTED_TOUCH_SENSORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12] as const;
const DOCUMENTED_BUTTONS = [
    3, 9, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
    50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 85, 86, 87, 88, 89, 90, 102, 103, 104, 105, 106, 107, 108,
    109, 110, 111, 112, 113, 116, 117, 118, 119,
] as const;

function expectEvent(result: PushMidiDecodeResult): PushMidiInputEvent {
    expect(result.status).toBe('event');
    if (result.status !== 'event') {
        throw new Error('Expected a decoded Push MIDI event');
    }
    return result.event;
}

function expectRejected(result: PushMidiDecodeResult, reason: string): void {
    expect(result).toEqual({
        status: 'rejected',
        reason,
    });
}

function bytesOf(result: Readonly<{ bytes: Uint8Array }>): number[] {
    return [...result.bytes];
}

function requestIdOf(result: PushMidiBeginRequestResult): number {
    expect(result.status).toBe('started');
    if (result.status !== 'started') {
        throw new Error('Expected a Push MIDI request to start');
    }
    return result.requestId;
}

describe('createPushMidiCodec', () => {
    it('decodes only channel-zero pad presses and both documented release forms', () => {
        const codec = createPushMidiCodec();

        expect(expectEvent(codec.decode([0x90, 36, 1]))).toEqual({
            kind: 'pad',
            note: 36,
            edge: 'pressed',
            velocity: 1,
        });
        expect(expectEvent(codec.decode([0x90, 99, 127]))).toEqual({
            kind: 'pad',
            note: 99,
            edge: 'pressed',
            velocity: 127,
        });
        expect(expectEvent(codec.decode([0x90, 36, 0]))).toEqual({
            kind: 'pad',
            note: 36,
            edge: 'released',
            velocity: 0,
        });
        expect(expectEvent(codec.decode([0x80, 99, 0]))).toEqual({
            kind: 'pad',
            note: 99,
            edge: 'released',
            velocity: 0,
        });

        expectRejected(codec.decode([0x91, 36, 127]), 'unsupported-channel');
        expectRejected(codec.decode([0x80, 36, 1]), 'invalid-value');
        expectRejected(codec.decode([0x90, 35, 127]), 'unsupported-note');
        expectRejected(codec.decode([0x90, 100, 127]), 'unsupported-note');
    });

    it('decodes pad poly pressure and channel pressure at their documented boundaries', () => {
        const codec = createPushMidiCodec();

        expect(expectEvent(codec.decode([0xa0, 36, 1]))).toEqual({
            kind: 'poly-pressure',
            note: 36,
            pressure: 1,
        });
        expect(expectEvent(codec.decode([0xa0, 99, 127]))).toEqual({
            kind: 'poly-pressure',
            note: 99,
            pressure: 127,
        });
        expect(expectEvent(codec.decode([0xd0, 0]))).toEqual({
            kind: 'channel-pressure',
            pressure: 0,
        });
        expect(expectEvent(codec.decode([0xd0, 127]))).toEqual({
            kind: 'channel-pressure',
            pressure: 127,
        });

        expectRejected(codec.decode([0xa0, 36, 0]), 'invalid-value');
        expectRejected(codec.decode([0xa0, 35, 64]), 'unsupported-note');
        expectRejected(codec.decode([0xd1, 64]), 'unsupported-channel');
    });

    it('decodes every documented encoder and the full two-complement movement range', () => {
        const codec = createPushMidiCodec();

        for (const control of DOCUMENTED_ENCODERS) {
            expect(expectEvent(codec.decode([0xb0, control, 1]))).toEqual({
                kind: 'encoder-turn',
                control,
                delta: 1,
            });
        }

        expect(expectEvent(codec.decode([0xb0, 14, 63]))).toEqual({
            kind: 'encoder-turn',
            control: 14,
            delta: 63,
        });
        expect(expectEvent(codec.decode([0xb0, 79, 64]))).toEqual({
            kind: 'encoder-turn',
            control: 79,
            delta: -64,
        });
        expect(expectEvent(codec.decode([0xb0, 79, 127]))).toEqual({
            kind: 'encoder-turn',
            control: 79,
            delta: -1,
        });

        expectRejected(codec.decode([0xb0, 14, 0]), 'zero-relative-movement');
        expectRejected(codec.decode([0xb0, 13, 1]), 'unsupported-control');
        expectRejected(codec.decode([0xb0, 16, 1]), 'unsupported-control');
        expectRejected(codec.decode([0xb0, 70, 1]), 'unsupported-control');
        expectRejected(codec.decode([0xb0, 80, 1]), 'unsupported-control');
    });

    it('decodes only documented encoder and touch-strip note-on edges', () => {
        const codec = createPushMidiCodec();

        for (const note of DOCUMENTED_TOUCH_SENSORS) {
            expect(expectEvent(codec.decode([0x90, note, 127]))).toEqual({
                kind: 'touch',
                note,
                edge: 'touched',
            });
            expect(expectEvent(codec.decode([0x90, note, 0]))).toEqual({
                kind: 'touch',
                note,
                edge: 'released',
            });
        }

        expectRejected(codec.decode([0x90, 11, 127]), 'unsupported-note');
        expectRejected(codec.decode([0x90, 13, 127]), 'unsupported-note');
        expectRejected(codec.decode([0x90, 0, 1]), 'invalid-value');
        expectRejected(codec.decode([0x80, 0, 0]), 'unsupported-note');
    });

    it('decodes button press and release edges only for the closed documented CC set', () => {
        const codec = createPushMidiCodec();

        for (const control of DOCUMENTED_BUTTONS) {
            expect(expectEvent(codec.decode([0xb0, control, 127]))).toEqual({
                kind: 'button',
                control,
                edge: 'pressed',
            });
            expect(expectEvent(codec.decode([0xb0, control, 0]))).toEqual({
                kind: 'button',
                control,
                edge: 'released',
            });
        }

        for (const reservedControl of [0, 1, 2, 4, 8, 10, 19, 32, 34, 64, 84, 91, 101, 114, 115, 120, 127]) {
            expectRejected(codec.decode([0xb0, reservedControl, 127]), 'unsupported-control');
        }
        expectRejected(codec.decode([0xb0, 3, 1]), 'invalid-value');
    });

    it('decodes touch-strip pitch bend only when the six unused lower bits are zero', () => {
        const codec = createPushMidiCodec();

        expect(expectEvent(codec.decode([0xe0, 0, 0]))).toEqual({
            kind: 'touch-strip-pitch-bend',
            value: 0,
        });
        expect(expectEvent(codec.decode([0xe0, 0, 64]))).toEqual({
            kind: 'touch-strip-pitch-bend',
            value: 8_192,
        });
        expect(expectEvent(codec.decode([0xe0, 64, 127]))).toEqual({
            kind: 'touch-strip-pitch-bend',
            value: 16_320,
        });

        expectRejected(codec.decode([0xe0, 1, 64]), 'invalid-value');
        expectRejected(codec.decode([0xef, 0, 64]), 'unsupported-channel');
    });

    it('rejects malformed lengths, bytes, statuses, and reserved system messages', () => {
        const codec = createPushMidiCodec();

        expectRejected(codec.decode([]), 'invalid-length');
        expectRejected(codec.decode([0x90, 36]), 'invalid-length');
        expectRejected(codec.decode([0xd0, 1, 2]), 'invalid-length');
        expectRejected(codec.decode([0x90, 36, 128]), 'invalid-data-byte');
        expectRejected(codec.decode([0x90, -1, 1]), 'invalid-byte');
        expectRejected(codec.decode([0x90, 36, 1.5]), 'invalid-byte');
        expectRejected(codec.decode([0x90, 36, 256]), 'invalid-byte');
        const sparseMessage = Array<number>(3);
        sparseMessage[0] = 0x90;
        sparseMessage[2] = 1;
        expectRejected(codec.decode(sparseMessage), 'invalid-byte');
        expectRejected(codec.decode([0xc0, 1]), 'unsupported-status');
        expectRejected(codec.decode([0xf8]), 'reserved-message');
        expectRejected(codec.decode([0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x1a, 0xf7]), 'reserved-message');
    });

    it('encodes only documented pad and button LED feedback', () => {
        const codec = createPushMidiCodec();

        const pad = codec.encode({
            kind: 'pad-led',
            note: 36,
            paletteIndex: 126,
        });
        expect(pad.status).toBe('encoded');
        if (pad.status === 'encoded') {
            expect(bytesOf(pad)).toEqual([0x90, 36, 126]);
        }

        const button = codec.encode({
            kind: 'button-led',
            control: 60,
            paletteIndex: 0,
        });
        expect(button.status).toBe('encoded');
        if (button.status === 'encoded') {
            expect(bytesOf(button)).toEqual([0xb0, 60, 0]);
        }

        // 127 is the top of the accepted palette range. Without these, narrowing
        // the bound to 0..126 leaves the suite green: 126 is accepted above and
        // 128 is rejected below, so neither pins the upper accepted endpoint.
        const padTop = codec.encode({ kind: 'pad-led', note: 99, paletteIndex: 127 });
        expect(padTop.status).toBe('encoded');
        if (padTop.status === 'encoded') {
            expect(bytesOf(padTop)).toEqual([0x90, 99, 127]);
        }

        const buttonTop = codec.encode({ kind: 'button-led', control: 3, paletteIndex: 127 });
        expect(buttonTop.status).toBe('encoded');
        if (buttonTop.status === 'encoded') {
            expect(bytesOf(buttonTop)).toEqual([0xb0, 3, 127]);
        }

        expect(codec.encode({ kind: 'pad-led', note: 35, paletteIndex: 1 })).toEqual({
            status: 'rejected',
            reason: 'unsupported-note',
        });
        expect(codec.encode({ kind: 'pad-led', note: 36.5, paletteIndex: 1 })).toEqual({
            status: 'rejected',
            reason: 'unsupported-note',
        });
        expect(codec.encode({ kind: 'pad-led', note: 36, paletteIndex: 128 })).toEqual({
            status: 'rejected',
            reason: 'invalid-value',
        });
        expect(codec.encode({ kind: 'button-led', control: 64, paletteIndex: 1 })).toEqual({
            status: 'rejected',
            reason: 'unsupported-control',
        });
        expect(codec.encode({ kind: 'button-led', control: 20.5, paletteIndex: 1 })).toEqual({
            status: 'rejected',
            reason: 'unsupported-control',
        });
        expect(codec.encode({ kind: 'button-led', control: 3, paletteIndex: -1 })).toEqual({
            status: 'rejected',
            reason: 'invalid-value',
        });
    });

    it('encodes the exact safe vendor aftertouch command and rejects reserved mode values', () => {
        const codec = createPushMidiCodec();

        const channelPressure = codec.encode({ kind: 'aftertouch-mode', mode: 0 });
        const polyPressure = codec.encode({ kind: 'aftertouch-mode', mode: 1 });
        expect(channelPressure.status).toBe('encoded');
        expect(polyPressure.status).toBe('encoded');
        if (channelPressure.status === 'encoded' && polyPressure.status === 'encoded') {
            expect(bytesOf(channelPressure)).toEqual([0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x1e, 0x00, 0xf7]);
            expect(bytesOf(polyPressure)).toEqual([0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x1e, 0x01, 0xf7]);
        }

        expect(codec.encode({ kind: 'aftertouch-mode', mode: 2 })).toEqual({
            status: 'rejected',
            reason: 'invalid-value',
        });
    });

    it('parses only the exact bounded Push 2 universal identity reply', () => {
        const codec = createPushMidiCodec();

        expect(codec.decode(IDENTITY_REPLY)).toEqual({
            status: 'reply',
            reply: {
                kind: 'identity',
                firmware: {
                    major: 1,
                    minor: 0,
                    build: 47,
                },
                serialNumber: 17_295_091,
                boardRevision: 1,
            },
        });

        for (const [index, replacement] of [
            [7, 0x1e],
            [8, 0x66],
            [10, 0x03],
        ] as const) {
            const mismatched: number[] = [...IDENTITY_REPLY];
            mismatched[index] = replacement;
            expectRejected(codec.decode(mismatched), 'unsupported-identity');
        }

        const truncated = IDENTITY_REPLY.slice(0, -1);
        expectRejected(codec.decode(truncated), 'invalid-length');

        const unboundedSerial: number[] = [...IDENTITY_REPLY];
        unboundedSerial[20] = 0x10;
        expectRejected(codec.decode(unboundedSerial), 'invalid-value');

        const nonDataFirmwareByte: number[] = [...IDENTITY_REPLY];
        nonDataFirmwareByte[12] = 0x80;
        expectRejected(codec.decode(nonDataFirmwareByte), 'invalid-data-byte');
    });

    it('serializes identity and MIDI-mode requests and preserves pending state on bad replies', () => {
        const codec = createPushMidiCodec();

        const identity = codec.beginRequest({ kind: 'identity' });
        expect(identity.status).toBe('started');
        if (identity.status === 'started') {
            expect(bytesOf(identity)).toEqual([0xf0, 0x7e, 0x01, 0x06, 0x01, 0xf7]);
        }
        expect(codec.beginRequest({ kind: 'midi-mode', mode: 1 })).toEqual({
            status: 'rejected',
            reason: 'reply-pending',
        });

        expect(
            codec.acceptReply(requestIdOf(identity), [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x01, 0xf7])
        ).toEqual({
            status: 'rejected',
            reason: 'reply-mismatch',
        });
        expect(codec.acceptReply(requestIdOf(identity), IDENTITY_REPLY.slice(0, -1))).toEqual({
            status: 'rejected',
            reason: 'invalid-length',
        });
        expect(codec.beginRequest({ kind: 'midi-mode', mode: 1 })).toEqual({
            status: 'rejected',
            reason: 'reply-pending',
        });

        expect(codec.acceptReply(requestIdOf(identity), IDENTITY_REPLY)).toEqual({
            status: 'accepted',
            reply: {
                kind: 'identity',
                firmware: {
                    major: 1,
                    minor: 0,
                    build: 47,
                },
                serialNumber: 17_295_091,
                boardRevision: 1,
            },
        });
        expect(codec.acceptReply(requestIdOf(identity), IDENTITY_REPLY)).toEqual({
            status: 'rejected',
            reason: 'unsolicited-reply',
        });
    });

    it('encodes a mode 0 (Live) request, the low end of the accepted mode range', () => {
        const codec = createPushMidiCodec();

        // Mode 0 is Live mode — the default the device boots into — and was the
        // one accepted mode never exercised. Narrowing the guard to 1..2 must
        // not leave the suite green.
        const request = codec.beginRequest({ kind: 'midi-mode', mode: 0 });
        expect(request.status).toBe('started');
        if (request.status === 'started') {
            expect(bytesOf(request)).toEqual([0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x00, 0xf7]);
        }

        expect(codec.acceptReply(requestIdOf(request), [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x00, 0xf7])).toEqual(
            {
                status: 'accepted',
                reply: {
                    kind: 'midi-mode',
                    mode: 0,
                },
            }
        );
    });

    it('rejects malformed mode replies and channel events without clearing the pending request', () => {
        const codec = createPushMidiCodec();
        const request = codec.beginRequest({ kind: 'midi-mode', mode: 1 });
        const requestId = requestIdOf(request);

        expect(codec.acceptReply(requestId, [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0xf7])).toEqual({
            status: 'rejected',
            reason: 'invalid-length',
        });
        expect(codec.acceptReply(requestId, [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x01, 0x00])).toEqual({
            status: 'rejected',
            reason: 'invalid-value',
        });
        expect(codec.acceptReply(requestId, [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x80, 0xf7])).toEqual({
            status: 'rejected',
            reason: 'invalid-data-byte',
        });
        expect(codec.acceptReply(requestId, [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x03, 0xf7])).toEqual({
            status: 'rejected',
            reason: 'invalid-value',
        });
        expect(codec.acceptReply(requestId, [0x90, 36, 127])).toEqual({
            status: 'rejected',
            reason: 'not-a-reply',
        });
        expect(codec.beginRequest({ kind: 'identity' })).toEqual({
            status: 'rejected',
            reason: 'reply-pending',
        });
        expect(codec.acceptReply(requestId, [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x01, 0xf7])).toMatchObject({
            status: 'accepted',
        });
    });

    it('requires an exact MIDI-mode reply and does not let a duplicate clear a later request', () => {
        const codec = createPushMidiCodec();
        const modeOneReply = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x01, 0xf7] as const;

        const modeRequest = codec.beginRequest({ kind: 'midi-mode', mode: 1 });
        expect(modeRequest.status).toBe('started');
        if (modeRequest.status === 'started') {
            expect(bytesOf(modeRequest)).toEqual(modeOneReply);
        }

        expect(
            codec.acceptReply(requestIdOf(modeRequest), [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x02, 0xf7])
        ).toEqual({
            status: 'rejected',
            reason: 'reply-mismatch',
        });
        expect(codec.acceptReply(requestIdOf(modeRequest), modeOneReply)).toEqual({
            status: 'accepted',
            reply: {
                kind: 'midi-mode',
                mode: 1,
            },
        });

        const secondRequest = codec.beginRequest({ kind: 'midi-mode', mode: 2 });
        expect(secondRequest.status).toBe('started');
        if (secondRequest.status === 'started') {
            // The mode byte must reach the wire, not just the pending-reply slot.
            expect(bytesOf(secondRequest)).toEqual([0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x02, 0xf7]);
        }
        expect(codec.acceptReply(requestIdOf(secondRequest), modeOneReply)).toEqual({
            status: 'rejected',
            reason: 'reply-mismatch',
        });
        expect(codec.beginRequest({ kind: 'identity' })).toEqual({
            status: 'rejected',
            reason: 'reply-pending',
        });
        expect(
            codec.acceptReply(requestIdOf(secondRequest), [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x02, 0xf7])
        ).toEqual({
            status: 'accepted',
            reply: {
                kind: 'midi-mode',
                mode: 2,
            },
        });
    });

    it('rejects invalid requests and unsolicited channel or reply input without changing sequencer state', () => {
        const codec = createPushMidiCodec();

        expect(codec.beginRequest({ kind: 'midi-mode', mode: 3 })).toEqual({
            status: 'rejected',
            reason: 'invalid-value',
        });
        expect(codec.acceptReply(0, IDENTITY_REPLY)).toEqual({
            status: 'rejected',
            reason: 'unsolicited-reply',
        });
        expect(codec.acceptReply(0, [0x90, 36, 127])).toEqual({
            status: 'rejected',
            reason: 'not-a-reply',
        });

        const identity = codec.beginRequest({ kind: 'identity' });
        expect(identity.status).toBe('started');
    });

    it('cancels only the matching pending request and allows a later request to complete', () => {
        const codec = createPushMidiCodec();
        const first = codec.beginRequest({ kind: 'identity' });
        expect(first).toMatchObject({ status: 'started', requestId: 1 });
        if (first.status !== 'started') {
            throw new Error('Expected the first request to start');
        }

        expect(codec.cancelRequest(first.requestId)).toEqual({ status: 'cancelled' });
        const second = codec.beginRequest({ kind: 'identity' });
        expect(second).toMatchObject({ status: 'started', requestId: 2 });
        if (second.status !== 'started') {
            throw new Error('Expected the second request to start');
        }

        expect(codec.cancelRequest(first.requestId)).toEqual({
            status: 'rejected',
            reason: 'request-mismatch',
        });
        expect(codec.acceptReply(second.requestId, IDENTITY_REPLY)).toMatchObject({ status: 'accepted' });
    });

    it('does not let a duplicate reply from a consumed request clear an identical later request', () => {
        const codec = createPushMidiCodec();
        const modeOneReply = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x01, 0xf7] as const;
        const first = codec.beginRequest({ kind: 'midi-mode', mode: 1 });
        if (first.status !== 'started') {
            throw new Error('Expected the first request to start');
        }
        expect(codec.acceptReply(first.requestId, modeOneReply)).toMatchObject({ status: 'accepted' });

        const second = codec.beginRequest({ kind: 'midi-mode', mode: 1 });
        if (second.status !== 'started') {
            throw new Error('Expected the second request to start');
        }
        expect(codec.acceptReply(first.requestId, modeOneReply)).toEqual({
            status: 'rejected',
            reason: 'request-mismatch',
        });
        expect(codec.beginRequest({ kind: 'identity' })).toEqual({
            status: 'rejected',
            reason: 'reply-pending',
        });
        expect(codec.acceptReply(second.requestId, modeOneReply)).toMatchObject({ status: 'accepted' });
    });
});
