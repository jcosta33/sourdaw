import { type Modulator, type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

type RestorableModulator = {
    readonly id: string;
    readonly name: string;
    readonly trackId: string;
    readonly enabled: boolean;
    readonly mappings: readonly RestorableMapping[];
    readonly kind: Modulator['kind'];
    readonly config:
        | {
              readonly kind: 'lfo';
              readonly waveform: 'sine' | 'square' | 'saw' | 'triangle' | 'random';
              readonly rate: number;
              readonly sync: boolean;
              readonly phase: number;
              readonly depth: number;
          }
        | {
              readonly kind: 'envelope';
              readonly attack: number;
              readonly decay: number;
              readonly sustain: number;
              readonly release: number;
              readonly triggerMode: 'midi' | 'audio' | 'sync';
          }
        | {
              readonly kind: 'step';
              readonly steps: readonly number[];
              readonly rate: number;
              readonly smooth: number;
          };
};

type RestorableMapping = Readonly<ModulatorMapping>;

type IncomingMapping = {
    readonly modulatorId: string;
    readonly mapping: RestorableMapping;
};

type RestoreTrackModulationReferencesInput = {
    readonly ownedModulators: readonly RestorableModulator[];
    readonly incomingMappings: readonly IncomingMapping[];
};

function copyMapping(mapping: RestorableMapping): ModulatorMapping {
    return {
        targetTrackId: mapping.targetTrackId,
        targetDeviceId: mapping.targetDeviceId,
        targetParamId: mapping.targetParamId,
        amount: mapping.amount,
    };
}

function copyModulator(modulator: RestorableModulator): Modulator {
    return {
        id: modulator.id,
        name: modulator.name,
        trackId: modulator.trackId,
        kind: modulator.kind,
        config: copyConfig(modulator.config),
        mappings: modulator.mappings.map(copyMapping),
        enabled: modulator.enabled,
    };
}

function copyConfig(config: RestorableModulator['config']): Modulator['config'] {
    if (config.kind === 'lfo') {
        return { ...config };
    }
    if (config.kind === 'envelope') {
        return { ...config };
    }
    return { ...config, steps: [...config.steps] };
}

function sameMapping(left: ModulatorMapping, right: RestorableMapping): boolean {
    return (
        left.targetTrackId === right.targetTrackId &&
        left.targetDeviceId === right.targetDeviceId &&
        left.targetParamId === right.targetParamId
    );
}

export function restoreTrackModulationReferences({
    ownedModulators,
    incomingMappings,
}: RestoreTrackModulationReferencesInput): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }

    const restored = [...state.modulators];
    for (const modulator of ownedModulators) {
        if (!restored.some(({ id }) => id === modulator.id)) {
            restored.push(copyModulator(modulator));
        }
    }
    for (const { modulatorId, mapping } of incomingMappings) {
        const index = restored.findIndex(({ id }) => id === modulatorId);
        const modulator = restored[index];
        if (!modulator || modulator.mappings.some((candidate) => sameMapping(candidate, mapping))) {
            continue;
        }
        restored[index] = {
            ...modulator,
            mappings: [...modulator.mappings, copyMapping(mapping)],
        };
    }

    modulationStore.set({ modulators: restored });
}
