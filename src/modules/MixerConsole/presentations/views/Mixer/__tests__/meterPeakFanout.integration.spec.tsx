import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import {
    getAudioContext,
    getMasterPeakLevel,
    initializeAudioEngine,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';

import { MixerLevelReadout } from '../MixerLevelReadout';

const hardware = await vi.hoisted(async () => {
    const { createMockAudioContext, createMockAudioNode } = await import('#/helpers/__tests__/audioContext.mock');
    const context = createMockAudioContext();
    const meters: ReturnType<typeof createMockAudioNode<'audio-worklet'>>[] = [];
    vi.stubGlobal(
        'AudioContext',
        vi.fn(function () {
            return context;
        })
    );
    vi.stubGlobal(
        'AudioWorkletNode',
        vi.fn(function (_context: BaseAudioContext, name: string) {
            const node = createMockAudioNode('audio-worklet');
            if (name === 'metering-processor') {
                meters.push(node);
            }
            return node;
        })
    );
    return { meters };
});

const scheduler = vi.hoisted(() => new Map<string, (time: number, delta: number) => void>());
vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: (id: string, tick: (time: number, delta: number) => void) => {
            scheduler.set(id, tick);
        },
        unregister: (id: string) => {
            scheduler.delete(id);
        },
    },
}));

class MeterResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
        const size = { inlineSize: 8, blockSize: 100 };
        this.callback(
            [
                {
                    target,
                    contentRect: new DOMRectReadOnly(0, 0, 8, 100),
                    borderBoxSize: [size],
                    contentBoxSize: [size],
                    devicePixelContentBoxSize: [size],
                },
            ],
            this
        );
    }
    unobserve(): void {}
    disconnect(): void {}
}

function masterAccumulator(): Float32Array {
    for (const meter of hardware.meters) {
        for (const [message] of meter.port.postMessage.mock.calls) {
            if (
                typeof message === 'object' &&
                message !== null &&
                'sab' in message &&
                message.sab instanceof SharedArrayBuffer
            ) {
                return new Float32Array(message.sab);
            }
        }
    }
    throw new Error('Actual engine did not publish a master meter SAB');
}

describe('real master peak fanout into mixer displays', () => {
    beforeAll(async () => {
        vi.stubGlobal('ResizeObserver', MeterResizeObserver);
        await initializeAudioEngine();
    });
    afterAll(async () => {
        resetAudioGraph();
        await getAudioContext().close();
        vi.unstubAllGlobals();
    });

    it('shares the actual drained master sample with the peak hold and instantaneous meter in one frame', () => {
        render(
            <TooltipProvider>
                <MixerLevelReadout trackId={null} control={null} value={null} />
            </TooltipProvider>
        );
        const accumulator = masterAccumulator();
        accumulator[0] = 0.5;
        const firstReader = getMasterPeakLevel(1234);
        expect(firstReader).toBe(0.5);
        expect(accumulator[0]).toBe(0);
        expect(scheduler.size).toBe(2);
        for (const tick of scheduler.values()) {
            tick(1234, 16);
        }
        expect(screen.getByTitle('Click to reset peak')).toHaveTextContent('-6.0');
        expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '-6.0 dB');
        accumulator[0] = 0.25;
        for (const tick of scheduler.values()) {
            tick(1235, 16);
        }
        expect(accumulator[0]).toBe(0);
        expect(screen.getByTitle('Click to reset peak')).toHaveTextContent('-6.0');
        expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '-12.0 dB');
        for (const tick of scheduler.values()) {
            tick(1236, 16);
        }
        expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '-60.0 dB');
        expect(screen.getByTitle('Click to reset peak')).toHaveTextContent('-6.0');
        fireEvent.click(screen.getByTitle('Click to reset peak'));
        expect(screen.getByTitle('Click to reset peak')).toHaveTextContent('-∞');
        accumulator[0] = 1;
        for (const tick of scheduler.values()) {
            tick(1237, 16);
        }
        expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '0.0 dB');
        expect(screen.getByTitle('Click to reset peak')).toHaveTextContent('0.0');
    });
});
