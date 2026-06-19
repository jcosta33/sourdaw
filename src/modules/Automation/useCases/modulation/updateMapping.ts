import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { type MappingTarget } from './removeMapping';

function sameTarget(mapping: ModulatorMapping, target: MappingTarget): boolean {
    return (
        mapping.targetTrackId === target.targetTrackId &&
        mapping.targetDeviceId === target.targetDeviceId &&
        mapping.targetParamId === target.targetParamId
    );
}

export function updateMapping(modulatorId: string, target: MappingTarget, patch: Partial<ModulatorMapping>): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }
    modulationStore.set({
        modulators: state.modulators.map((m) =>
            m.id === modulatorId
                ? {
                      ...m,
                      // Match by the FULL destination identity. Matching on
                      // targetParamId alone mutated every mapping sharing that
                      // param across tracks/devices. The target id fields are
                      // re-pinned after the patch so a patch can never relocate
                      // the mapping to a different destination.
                      mappings: m.mappings.map((x) =>
                          sameTarget(x, target)
                              ? {
                                    ...x,
                                    ...patch,
                                    targetTrackId: x.targetTrackId,
                                    targetDeviceId: x.targetDeviceId,
                                    targetParamId: x.targetParamId,
                                }
                              : x
                      ),
                  }
                : m
        ),
    });
}
