import { yeastStore } from '../stores/yeastStore';

import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';

const MAX_GROOVE_LOOKAHEAD_BEATS = 4;

export type YeastSchedulingLookahead = {
    earlyBeats: number;
    lateBeats: number;
};

export function getYeastSchedulingLookahead(): YeastSchedulingLookahead {
    const processors = yeastStore.value?.processors ?? [];
    let earlyBeats = 0;
    let lateBeats = 0;

    for (const processor of createYeastRuntimeProjection(processors)) {
        if (processor.bypassed || processor.type !== 'groove') {
            continue;
        }

        const amount = Math.max(0, Math.min(1, processor.params.groove_amount ?? 0.5));
        const stepBeats = Math.max(1 / 32, Math.min(1, processor.params.groove_step_beats ?? 0.25));
        const slotCount = Math.max(1, Math.min(32, Math.round(processor.params.groove_slot_count ?? 16)));
        for (let index = 0; index < slotCount; index++) {
            const offsetBeats = (processor.params[`groove_timing_${index}`] ?? 0) * amount * stepBeats;
            earlyBeats = Math.max(earlyBeats, -offsetBeats);
            lateBeats = Math.max(lateBeats, offsetBeats);
        }
    }

    return {
        earlyBeats: Math.min(MAX_GROOVE_LOOKAHEAD_BEATS, earlyBeats),
        lateBeats: Math.min(MAX_GROOVE_LOOKAHEAD_BEATS, lateBeats),
    };
}
