import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeArpPatternParams, defaultStep, withArpPatternParams } from '../../models/ArpPattern';

import type { YeastRuntimeStatus } from '../../models/YeastProcessorProjection';
import type { YeastProcessorInfo } from '../../stores/yeastStore';

type YeastStateStub = { processors: YeastProcessorInfo[]; uiLevel: 3 };

const store = vi.hoisted((): { value: { processors: unknown[]; uiLevel: 3 }; set: ReturnType<typeof vi.fn> } => ({
    value: { processors: [], uiLevel: 3 },
    set: vi.fn(),
}));

function createInitialState(arpParams: Record<string, number>): YeastStateStub {
    return {
        processors: [
            { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: arpParams },
            { id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false, params: {} },
        ],
        uiLevel: 3,
    };
}

const commit = vi.hoisted(() => vi.fn());
const runtimeMocks = vi.hoisted(() => ({
    createYeastRuntimeProjection: vi.fn((processors: readonly YeastProcessorInfo[]) =>
        processors.map((processor) => ({
            id: processor.id,
            type: processor.type,
            bypassed: processor.bypassed,
            params: { ...processor.params },
        }))
    ),
    applyYeastRuntimeProjection: vi.fn(
        (_projection: readonly { id: string; params: Record<string, number> }[]): Promise<void> => Promise.resolve()
    ),
    getYeastRuntimeStatus: vi.fn((): YeastRuntimeStatus => 'ready'),
    getYeastRuntimeError: vi.fn((): string | undefined => undefined),
}));

vi.mock('../../stores/yeastStore', () => ({ yeastStore: store }));
vi.mock('../../engine/yeastRuntime', () => ({
    applyYeastRuntimeProjection: runtimeMocks.applyYeastRuntimeProjection,
    getYeastRuntimeStatus: runtimeMocks.getYeastRuntimeStatus,
    getYeastRuntimeError: runtimeMocks.getYeastRuntimeError,
}));
vi.mock('../commitYeastProjection', () => ({ commitYeastProjection: commit }));
vi.mock('../createYeastRuntimeProjection', () => ({
    createYeastRuntimeProjection: runtimeMocks.createYeastRuntimeProjection,
}));

const { setYeastArpPattern } = await import('../setYeastArpPattern');

function committedArpParams(): Record<string, number> | undefined {
    const processors = commit.mock.calls[0]?.[0] as readonly YeastProcessorInfo[] | undefined;
    return processors?.find((processor) => processor.id === 'arp-1')?.params;
}

describe('setYeastArpPattern', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.value = createInitialState({ mode: 7, rate_denom: 16 });
        // Mirror production: `commitYeastProjection` writes the store, and the
        // use case re-reads it to build the runtime projection.
        commit.mockImplementation((processors: readonly YeastProcessorInfo[]) => {
            store.value = { ...store.value, processors: [...processors] };
        });
    });

    it('commits the pattern and pushes it at the runtime in the same call', async () => {
        const pattern = [
            { ...defaultStep(), octaveOffset: 1 },
            { ...defaultStep(), stepType: 'rest' as const },
        ];

        await setYeastArpPattern('arp-1', pattern);

        expect(decodeArpPatternParams(committedArpParams())).toEqual(pattern);
        // The runtime must see the same edit — a commit that never reaches the
        // Worker is exactly the dead-UI defect this use case exists to close.
        const applied = runtimeMocks.applyYeastRuntimeProjection.mock.calls[0]?.[0].find(
            (processor) => processor.id === 'arp-1'
        );
        expect(decodeArpPatternParams(applied?.params)).toEqual(pattern);
    });

    it('leaves the arpeggiator’s other params untouched', async () => {
        await setYeastArpPattern('arp-1', [{ ...defaultStep(), velocity: 44, velocityOverride: true }]);

        expect(committedArpParams()?.mode).toBe(7);
        expect(committedArpParams()?.rate_denom).toBe(16);
    });

    it('does not resurrect steps beyond a shortened pattern', async () => {
        store.value = createInitialState(
            withArpPatternParams({ mode: 7, rate_denom: 16 }, [
                { ...defaultStep() },
                { ...defaultStep() },
                { ...defaultStep(), octaveOffset: 3 },
            ])
        );

        await setYeastArpPattern('arp-1', [{ ...defaultStep() }]);

        expect(committedArpParams()?.pattern_2_octave).toBeUndefined();
        expect(decodeArpPatternParams(committedArpParams())).toHaveLength(1);
    });

    it('ignores a processor that is not an arpeggiator', async () => {
        await setYeastArpPattern('groove-1', [{ ...defaultStep(), octaveOffset: 1 }]);

        expect(commit).not.toHaveBeenCalled();
        expect(runtimeMocks.applyYeastRuntimeProjection).not.toHaveBeenCalled();
    });

    it('ignores an unknown processor id', async () => {
        await setYeastArpPattern('missing', [{ ...defaultStep() }]);

        expect(commit).not.toHaveBeenCalled();
    });
});
