import { midiStore } from '../../stores/midiStore';

/** Whether the store holds a controller list and a pitch-bend list for the clip, empty or not. */
export function readControllerListPresence(clipId: string): { cc: boolean; pitchBend: boolean } {
    const midiState = midiStore.value;
    return {
        cc: Object.hasOwn(midiState?.ccByClipId ?? {}, clipId),
        pitchBend: Object.hasOwn(midiState?.pitchBendByClipId ?? {}, clipId),
    };
}
