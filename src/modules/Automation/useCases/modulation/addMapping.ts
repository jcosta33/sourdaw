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
                // Re-adding an existing destination is a no-op: the picker's
                // default amount (0.5) must not clobber a user-tuned amount.
                // Use `updateMapping` to deliberately change an amount.
                return m;
            }
            return { ...m, mappings: [...m.mappings, mapping] };
        }),
    });
}
