import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

export function getTimeSignatureChanges(): readonly import('../../models/TimeSignatureMap').TimeSignatureChange[] {
    return timeSignatureMapStore.value?.changes ?? [];
}
