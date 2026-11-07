import { describe, expect, it } from 'vitest';

import {
    createTransientShaperControl,
    readTransientShaperControl,
    type TransientShaperControlSnapshot,
    writeTransientShaperImmediateGain,
} from '../TransientShaperControl';

function snapshot(): TransientShaperControlSnapshot {
    return {
        resetEpoch: 7,
        attackGain: { value: 0.5, frame: 12 },
        sustainGain: { value: 0.75, frame: 34 },
    };
}

describe('Transient Shaper control reader', () => {
    it('keeps its previous snapshot when a host write begins after its entry check', () => {
        const { control } = createTransientShaperControl(0);
        writeTransientShaperImmediateGain(control, 'attackGain', 2, 48000);
        // The host's whole write lands between the reader's two sequence loads:
        // the counter it saw at entry is even, so only the closing load sees it.
        let raced = false;
        const fields = new Proxy(control.fields, {
            get(target, key) {
                if (!raced && typeof key === 'string' && /^\d+$/.test(key)) {
                    raced = true;
                    writeTransientShaperImmediateGain(control, 'attackGain', 0, 48128);
                }
                return Reflect.get(target, key);
            },
        });
        const into = snapshot();
        expect(readTransientShaperControl({ sequence: control.sequence, fields }, into)).toBe(false);
        expect(raced).toBe(true);
        expect(into).toEqual(snapshot());
        expect(readTransientShaperControl(control, into)).toBe(true);
        expect(into.attackGain).toEqual({ value: 0, frame: 48128 });
    });
});
