import { describe, expect, it, vi } from 'vitest';

import { toGrandBouleDeviceState } from '../../models/GrandBouleDeviceState';
import { projectGrandBouleMorphState } from '../../models/ProjectGrandBouleMorphState';
import { prepareOfflineGrandBoule } from '../prepareOfflineGrandBoule';

describe('prepareOfflineGrandBoule', () => {
    it('projects the immutable render snapshot when live project state differs', () => {
        const snapshotMorph = {
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: 0.2,
            enabled: true,
        };
        const liveMorph = { ...snapshotMorph, morphPosition: 0.9, layerBalance: -0.7 };
        const postMessage = vi.fn();

        prepareOfflineGrandBoule({
            deviceState: toGrandBouleDeviceState(snapshotMorph),
            port: { postMessage } as unknown as MessagePort,
        });

        const posted = postMessage.mock.calls.map(([message]) => message);
        expect(posted).toEqual(
            projectGrandBouleMorphState(snapshotMorph).map((parameter) => ({ type: 'param', ...parameter }))
        );
        expect(posted).not.toEqual(
            projectGrandBouleMorphState(liveMorph).map((parameter) => ({ type: 'param', ...parameter }))
        );
    });
});
