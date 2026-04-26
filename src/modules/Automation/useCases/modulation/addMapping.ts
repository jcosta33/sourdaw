import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

export function addMapping(modulatorId: string, mapping: ModulatorMapping): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }
    modulationStore.set({
        modulators: state.modulators.map((m) => {
            if (m.id !== modulatorId) {
                return m;
            }
            const exists = m.mappings.some(
                (x) =>
                    x.targetTrackId === mapping.targetTrackId &&
                    x.targetDeviceId === mapping.targetDeviceId &&
                    x.targetParamId === mapping.targetParamId
            );
            if (exists) {
                return {
                    ...m,
                    mappings: m.mappings.map((x) =>
                        x.targetTrackId === mapping.targetTrackId &&
                        x.targetDeviceId === mapping.targetDeviceId &&
                        x.targetParamId === mapping.targetParamId
                            ? { ...x, ...mapping }
                            : x
                    ),
                };
            }
            return { ...m, mappings: [...m.mappings, mapping] };
        }),
    });
}
