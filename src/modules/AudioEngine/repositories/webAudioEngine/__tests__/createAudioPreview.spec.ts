import { describe, expect, it, vi } from 'vitest';

import { createAudioPreview, type AudioPreviewPorts } from '../createAudioPreview';

function createEdgeNode() {
    return { connect: vi.fn(), disconnect: vi.fn() };
}

function createContextStub() {
    const oscillators: Array<{
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        onended: (() => void) | null;
    }> = [];
    const envelopes: Array<{
        gain: { setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const raw = {
        currentTime: 3,
        destination: { label: 'destination' },
        createOscillator: vi.fn(() => {
            const oscillator = {
                type: 'square',
                frequency: { value: 0 },
                connect: vi.fn(),
                disconnect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                onended: null as (() => void) | null,
            };
            oscillators.push(oscillator);
            return oscillator;
        }),
        createGain: vi.fn(() => {
            const envelope = {
                gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
                connect: vi.fn(),
                disconnect: vi.fn(),
            };
            envelopes.push(envelope);
            return envelope;
        }),
    };
    return { context: raw as unknown as AudioContext, raw, oscillators, envelopes };
}

function createFixture(overrides: Partial<AudioPreviewPorts> = {}) {
    const gate = createEdgeNode();
    const monitorMono = createEdgeNode();
    const stub = createContextStub();
    const preview = createAudioPreview({
        readContext: () => stub.context,
        readProgrammeGate: () => gate as unknown as GainNode,
        readMonitorMono: () => monitorMono as unknown as GainNode,
        isDisposed: () => false,
        isFallback: () => false,
        ...overrides,
    });
    return { preview, gate, monitorMono, ...stub };
}

describe('createAudioPreview', () => {
    it('keeps the programme gate closed while an exclusive intent is current, even when suppression is lifted', () => {
        const { preview, gate, monitorMono } = createFixture();

        const exclusive = preview.beginExclusiveIntent();
        preview.setProgrammeSuppressed(false);

        expect(gate.disconnect).toHaveBeenCalledExactlyOnceWith(monitorMono);
        expect(gate.connect).not.toHaveBeenCalled();

        exclusive.release();
        preview.setProgrammeSuppressed(false);

        expect(gate.connect).toHaveBeenCalledExactlyOnceWith(monitorMono);
    });

    it('makes ordinary intents wait on a held restoration only until it settles, rejected or not', async () => {
        const { preview } = createFixture();
        const restoration = Promise.withResolvers<void>();

        expect(preview.beginOrdinaryIntent().ready).toBeUndefined();
        preview.holdRestoration(restoration.promise);
        expect(preview.beginOrdinaryIntent().ready).toBe(restoration.promise);

        restoration.reject(new Error('restore failed'));
        await restoration.promise.catch(() => undefined);
        await Promise.resolve();

        expect(preview.beginOrdinaryIntent().ready).toBeUndefined();
    });

    it('opens a fresh intent lifetime only when the outermost of nested resets ends', () => {
        const { preview } = createFixture();
        const outgoing = preview.beginOrdinaryIntent();

        preview.beginReset();
        preview.beginReset();
        preview.disposeIntents();
        preview.endReset();

        expect(outgoing.signal.reason).toBe('disposed');
        expect(preview.beginOrdinaryIntent().isCurrent()).toBe(false);

        preview.endReset();

        expect(preview.beginOrdinaryIntent().isCurrent()).toBe(true);
    });

    it('refuses a non-finite or negative tone with the documented RangeError', () => {
        const { preview, raw } = createFixture();
        const intent = preview.beginOrdinaryIntent();
        const message = 'Preview tone frequency and duration must be finite.';

        expect(() => preview.playTone(Number.NaN, 0.1, intent)).toThrow(new RangeError(message));
        expect(() => preview.playTone(440, Number.POSITIVE_INFINITY, intent)).toThrow(new RangeError(message));
        expect(() => preview.playTone(440, -0.1, intent)).toThrow(new RangeError(message));
        expect(raw.createOscillator).not.toHaveBeenCalled();
    });

    it('starts a tone only after its intent’s restoration resolves', async () => {
        const { preview, oscillators, envelopes } = createFixture();
        const restoration = Promise.withResolvers<void>();
        preview.holdRestoration(restoration.promise);

        const tone = preview.playTone(440, 0.5, preview.beginOrdinaryIntent());

        expect(oscillators[0]?.start).not.toHaveBeenCalled();
        restoration.resolve();
        await tone?.ready;

        expect(envelopes[0]?.gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0.4, 3);
        expect(oscillators[0]?.start).toHaveBeenCalledTimes(1);
        expect(oscillators[0]?.stop).toHaveBeenCalledExactlyOnceWith(3.5);
    });

    describe('preview tone lifecycle', () => {
        it('stops and disconnects a started tone when its intent is disposed', () => {
            const { preview, oscillators, envelopes } = createFixture();

            preview.playTone(440, 0.5, preview.beginOrdinaryIntent());
            expect(oscillators[0]?.stop).toHaveBeenCalledTimes(1);
            preview.disposeIntents();

            expect(oscillators[0]?.stop).toHaveBeenCalledTimes(2);
            expect(oscillators[0]?.stop).toHaveBeenLastCalledWith();
            expect(envelopes[0]?.disconnect).toHaveBeenCalledTimes(1);
        });

        it('releases a tone when the oscillator ends naturally and a later abort does not stop it again', () => {
            const { preview, oscillators, envelopes } = createFixture();

            preview.playTone(440, 0.5, preview.beginOrdinaryIntent());
            oscillators[0]?.onended?.();

            expect(envelopes[0]?.disconnect).toHaveBeenCalledTimes(1);
            preview.disposeIntents();

            expect(oscillators[0]?.stop).toHaveBeenCalledTimes(1);
            expect(envelopes[0]?.disconnect).toHaveBeenCalledTimes(1);
        });

        it('finishes once when stopped twice', () => {
            const { preview, oscillators, envelopes } = createFixture();

            const tone = preview.playTone(440, 0.5, preview.beginOrdinaryIntent());
            tone?.stop();
            tone?.stop();

            expect(oscillators[0]?.stop).toHaveBeenCalledTimes(2);
            expect(envelopes[0]?.disconnect).toHaveBeenCalledTimes(1);
        });

        it('gives the tone a 0.4 to 0.001 exponential envelope routed to the destination', () => {
            const { preview, raw, envelopes } = createFixture();

            preview.playTone(440, 0.5, preview.beginOrdinaryIntent());

            expect(envelopes[0]?.gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0.4, 3);
            expect(envelopes[0]?.gain.exponentialRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(0.001, 3.5);
            expect(envelopes[0]?.connect).toHaveBeenCalledExactlyOnceWith(raw.destination);
        });

        it('does not start a tone whose intent is no longer current when its start is reached', () => {
            const { preview, oscillators } = createFixture();
            const intent = { ...preview.beginOrdinaryIntent(), isCurrent: vi.fn() };
            intent.isCurrent.mockReturnValueOnce(true).mockReturnValue(false);

            preview.playTone(440, 0.5, intent);

            expect(oscillators[0]?.start).not.toHaveBeenCalled();
        });
    });

    describe('programme gate guards', () => {
        it('leaves the programme gate untouched while the engine is in fallback', () => {
            const { preview, gate } = createFixture({ isFallback: () => true });

            preview.setProgrammeSuppressed(true);
            preview.setProgrammeSuppressed(false);

            expect(gate.disconnect).not.toHaveBeenCalled();
            expect(gate.connect).not.toHaveBeenCalled();
        });

        it('leaves the programme gate untouched once the engine is disposed', () => {
            const { preview, gate } = createFixture({ isDisposed: () => true });

            preview.setProgrammeSuppressed(true);
            preview.setProgrammeSuppressed(false);

            expect(gate.disconnect).not.toHaveBeenCalled();
            expect(gate.connect).not.toHaveBeenCalled();
        });
    });
});
