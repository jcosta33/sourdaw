import { describe, expect, it, vi } from 'vitest';

import { createScheduledSources, type ScheduledSourcesPorts } from '../createScheduledSources';

function createSourceStub(stop: () => void = vi.fn()): AudioScheduledSourceNode {
    return { stop, addEventListener: vi.fn() } as unknown as AudioScheduledSourceNode;
}

function createContextStub() {
    const envelopes: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
    const context = {
        currentTime: 7,
        createOscillator: vi.fn(() => ({
            type: 'square',
            frequency: { value: 0 },
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null as (() => void) | null,
        })),
        createGain: vi.fn(() => {
            const envelope = {
                gain: {
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn(),
                    exponentialRampToValueAtTime: vi.fn(),
                },
                connect: vi.fn(),
                disconnect: vi.fn(),
            };
            envelopes.push(envelope);
            return envelope;
        }),
    };
    return { envelopes, context: context as unknown as AudioContext, raw: context };
}

function createPorts(overrides: Partial<ScheduledSourcesPorts> = {}): ScheduledSourcesPorts {
    const { context } = createContextStub();
    return {
        readContext: () => context,
        readMasterGain: () => ({}) as GainNode,
        assertActive: () => {},
        isFallback: () => false,
        ...overrides,
    };
}

describe('createScheduledSources', () => {
    it('stops every tracked source after one refuses to stop, then empties the list', () => {
        const sources = createScheduledSources(createPorts());
        const refusing = createSourceStub(() => {
            throw new Error('already stopped');
        });
        const later = createSourceStub();
        sources.register(refusing);
        sources.register(later);

        expect(() => sources.stopAll()).not.toThrow();

        expect(later.stop).toHaveBeenCalledExactlyOnceWith(7);
        expect(sources.nodes()).toEqual([]);
    });

    it('releases the envelope when a scheduled oscillator ends', () => {
        const { context, envelopes } = createContextStub();
        const sources = createScheduledSources(createPorts({ readContext: () => context }));

        sources.scheduleOscillator(440, 1, 0.1);
        const [oscillator] = sources.nodes();
        oscillator?.onended?.(new Event('ended'));

        expect(envelopes[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(sources.nodes()).toEqual([]);
    });

    it('stops tracking a registered source when it ends naturally', () => {
        const addEventListener = vi.fn<(type: string, listener: () => void) => void>();
        const voice = { stop: vi.fn(), addEventListener } as unknown as AudioScheduledSourceNode;
        const sources = createScheduledSources(createPorts());
        sources.register(voice);
        expect(sources.nodes()).toContain(voice);

        const onEnded = addEventListener.mock.calls.find(([type]) => type === 'ended')?.[1];
        expect(onEnded).toBeTypeOf('function');
        onEnded?.();

        expect(sources.nodes()).not.toContain(voice);
    });

    it('creates and tracks nothing on the fallback graph', () => {
        const { context, raw } = createContextStub();
        const sources = createScheduledSources(createPorts({ readContext: () => context, isFallback: () => true }));

        sources.scheduleClick(0, true);
        sources.register(createSourceStub());

        expect(raw.createOscillator).not.toHaveBeenCalled();
        expect(sources.nodes()).toEqual([]);
    });

    it('refuses a disposed engine before the fallback check', () => {
        const disposed = new Error('Audio engine has been disposed.');
        const sources = createScheduledSources(
            createPorts({
                isFallback: () => true,
                assertActive: () => {
                    throw disposed;
                },
            })
        );

        expect(() => sources.scheduleOscillator(440, 0, 1)).toThrow(disposed);
        expect(() => sources.register(createSourceStub())).toThrow(disposed);
    });
});
