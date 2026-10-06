import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/modulationStore', () => ({
    modulationStore: {
        get value() {
            return mockState;
        },
        set: vi.fn(),
    },
    modulationRuntimeStore: { value: undefined, set: vi.fn() },
}));

vi.mock('../../../useCases/modulation/addModulator', () => ({ addModulator: vi.fn() }));
vi.mock('../../../useCases/modulation/removeModulator', () => ({ removeModulator: vi.fn() }));
vi.mock('../../../useCases/modulation/updateModulator', () => ({ updateModulator: vi.fn() }));
vi.mock('../../../useCases/modulation/addMapping', () => ({ addMapping: vi.fn() }));
vi.mock('../../../useCases/modulation/removeMapping', () => ({ removeMapping: vi.fn() }));

import { type AppAction } from '#/utils/handlerContract';

import { addMapping } from '../../../useCases/modulation/addMapping';
import { addModulator } from '../../../useCases/modulation/addModulator';
import { removeMapping } from '../../../useCases/modulation/removeMapping';
import { removeModulator } from '../../../useCases/modulation/removeModulator';
import { updateModulator } from '../../../useCases/modulation/updateModulator';
import { handleAddMapping } from '../handleAddMapping';
import { handleAddModulator } from '../handleAddModulator';
import { handleRemoveMapping } from '../handleRemoveMapping';
import { handleRemoveModulator } from '../handleRemoveModulator';
import { handleUpdateModulator } from '../handleUpdateModulator';

// The handlers read `modulationStore.value` for their describe-time captures.
let mockState: { modulators: unknown[] } = { modulators: [] };

beforeEach(() => {
    vi.clearAllMocks();
    mockState = { modulators: [] };
});

const priorModulator = {
    id: 'mod-lfo-1',
    name: 'Filter wobble',
    trackId: 't-drums',
    kind: 'lfo' as const,
    config: { kind: 'lfo' as const, waveform: 'sine' as const, rate: 1, sync: true, phase: 0, depth: 1 },
    mappings: [{ targetTrackId: 't-drums', targetDeviceId: 'dev-1', targetParamId: 'cutoff', amount: 0.4 }],
    enabled: true,
};

type AddModulatorAction = Extract<AppAction, { type: 'addModulator' }>;

describe('handleAddModulator', () => {
    it('mints the modulator id onto the payload and executes with it', () => {
        const action: AddModulatorAction = {
            type: 'addModulator',
            payload: {
                modulator: {
                    name: 'Wobble',
                    trackId: 't-drums',
                    kind: 'lfo',
                    config: priorModulator.config,
                    mappings: [],
                    enabled: true,
                },
            },
        };
        handleAddModulator.execute(action);
        const [spec, id] = vi.mocked(addModulator).mock.calls[0]!;
        expect(id).toMatch(/^mod-lfo-/);
        expect(action.payload.modulatorId).toBe(id);
        expect(spec.name).toBe('Wobble');
        const { inverseAction } = handleAddModulator.describe(action);
        expect(inverseAction).toEqual({ type: 'removeModulator', payload: { modulatorId: id } });
    });

    it('reuses an explicit modulatorId', () => {
        const action: AddModulatorAction = {
            type: 'addModulator',
            payload: {
                modulator: {
                    name: 'W',
                    trackId: 't',
                    kind: 'step',
                    config: { kind: 'step', steps: [0, 1], rate: 1, smooth: 0 },
                    mappings: [],
                    enabled: true,
                },
                modulatorId: 'mod-step-fixed',
            },
        };
        handleAddModulator.execute(action);
        expect(vi.mocked(addModulator).mock.calls[0]![1]).toBe('mod-step-fixed');
        // The step modulator's frozen steps arrive at the use case as a mutable copy.
        expect(vi.mocked(addModulator).mock.calls[0]![0].config).toEqual({
            kind: 'step',
            steps: [0, 1],
            rate: 1,
            smooth: 0,
        });
    });
});

describe('handleRemoveModulator', () => {
    it('executes the removal and inverts onto the exact prior modulator', () => {
        mockState = { modulators: [priorModulator] };
        handleRemoveModulator.execute({ type: 'removeModulator', payload: { modulatorId: 'mod-lfo-1' } });
        expect(removeModulator).toHaveBeenCalledWith('mod-lfo-1');
        const { inverseAction } = handleRemoveModulator.describe({
            type: 'removeModulator',
            payload: { modulatorId: 'mod-lfo-1' },
        });
        expect(inverseAction).toEqual({
            type: 'addModulator',
            payload: {
                modulator: {
                    name: 'Filter wobble',
                    trackId: 't-drums',
                    kind: 'lfo',
                    config: priorModulator.config,
                    mappings: priorModulator.mappings,
                    enabled: true,
                },
                modulatorId: 'mod-lfo-1',
            },
        });
    });

    it('carries no inverse when the modulator is gone', () => {
        const { inverseAction } = handleRemoveModulator.describe({
            type: 'removeModulator',
            payload: { modulatorId: 'gone' },
        });
        expect(inverseAction).toBeFalsy();
    });
});

describe('handleUpdateModulator', () => {
    it('refuses an empty trackId patch before any effect', () => {
        const action = {
            type: 'updateModulator' as const,
            payload: { modulatorId: 'mod-lfo-1', patch: { trackId: '' } },
        };
        expect(handleUpdateModulator.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });

    it('executes the patch and inverts by patching back only the touched keys', () => {
        mockState = { modulators: [priorModulator] };
        handleUpdateModulator.execute({
            type: 'updateModulator',
            payload: { modulatorId: 'mod-lfo-1', patch: { name: 'Renamed', enabled: false } },
        });
        expect(updateModulator).toHaveBeenCalledWith('mod-lfo-1', { name: 'Renamed', enabled: false });
        const { inverseAction } = handleUpdateModulator.describe({
            type: 'updateModulator',
            payload: { modulatorId: 'mod-lfo-1', patch: { name: 'Renamed', enabled: false } },
        });
        expect(inverseAction).toEqual({
            type: 'updateModulator',
            payload: { modulatorId: 'mod-lfo-1', patch: { name: 'Filter wobble', enabled: true } },
        });
    });
});

describe('handleAddMapping', () => {
    it('executes the add and inverts onto a target removal', () => {
        mockState = { modulators: [priorModulator] };
        const mapping = { targetTrackId: 't-bass', targetDeviceId: 'dev-2', targetParamId: 'res', amount: 0.5 };
        handleAddMapping.execute({ type: 'addMapping', payload: { modulatorId: 'mod-lfo-1', mapping } });
        expect(addMapping).toHaveBeenCalledWith('mod-lfo-1', mapping);
        const { inverseAction } = handleAddMapping.describe({
            type: 'addMapping',
            payload: { modulatorId: 'mod-lfo-1', mapping },
        });
        expect(inverseAction).toEqual({
            type: 'removeMapping',
            payload: {
                modulatorId: 'mod-lfo-1',
                target: { targetTrackId: 't-bass', targetDeviceId: 'dev-2', targetParamId: 'res' },
            },
        });
    });

    it('carries no inverse when the destination already exists — the add was the documented no-op', () => {
        mockState = { modulators: [priorModulator] };
        const { inverseAction } = handleAddMapping.describe({
            type: 'addMapping',
            payload: { modulatorId: 'mod-lfo-1', mapping: priorModulator.mappings[0]! },
        });
        expect(inverseAction).toBeNull();
    });
});

describe('handleRemoveMapping', () => {
    it('executes the removal and inverts onto the exact prior mapping, amount included', () => {
        mockState = { modulators: [priorModulator] };
        handleRemoveMapping.execute({
            type: 'removeMapping',
            payload: {
                modulatorId: 'mod-lfo-1',
                target: { targetTrackId: 't-drums', targetDeviceId: 'dev-1', targetParamId: 'cutoff' },
            },
        });
        expect(removeMapping).toHaveBeenCalledWith('mod-lfo-1', {
            targetTrackId: 't-drums',
            targetDeviceId: 'dev-1',
            targetParamId: 'cutoff',
        });
        const { inverseAction } = handleRemoveMapping.describe({
            type: 'removeMapping',
            payload: {
                modulatorId: 'mod-lfo-1',
                target: { targetTrackId: 't-drums', targetDeviceId: 'dev-1', targetParamId: 'cutoff' },
            },
        });
        expect(inverseAction).toEqual({
            type: 'addMapping',
            payload: { modulatorId: 'mod-lfo-1', mapping: priorModulator.mappings[0] },
        });
    });
});
