import { GRINDER_CAB_LIBRARY } from '../../models/GrinderPatch';

export function getCabIrSlot(cab_ir_id: string): number | null {
    const slot = GRINDER_CAB_LIBRARY.findIndex((cabinet) => cabinet.id === cab_ir_id);
    return slot >= 0 ? slot : null;
}
