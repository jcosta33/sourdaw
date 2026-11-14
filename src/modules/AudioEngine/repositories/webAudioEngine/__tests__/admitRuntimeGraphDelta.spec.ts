import { describe, expect, it, vi } from 'vitest';

import { admitRuntimeGraphDelta, type RuntimeGraphAdmissionPorts } from '../admitRuntimeGraphDelta';

import type {
    RuntimeGraphDeltaNode,
    RuntimeGraphProjectRevisionValidator,
    RuntimeGraphTopologyValidator,
} from '../../../models/RuntimeGraphDelta';

const NODES: readonly RuntimeGraphDeltaNode[] = [{ id: 'track-1', kind: 'audio', devices: [] }];

function createPorts(
    projectValidator: RuntimeGraphProjectRevisionValidator | null,
    topologyValidator: RuntimeGraphTopologyValidator | null,
    revision = 3
): RuntimeGraphAdmissionPorts {
    return {
        readRevision: () => revision,
        readProjectRevisionValidator: () => projectValidator,
        readTopologyValidator: () => topologyValidator,
    };
}

describe('admitRuntimeGraphDelta', () => {
    it('admits a current command and hands each validator its own input', () => {
        const projectValidator = vi.fn(() => true);
        const topologyValidator = vi.fn(() => true);

        const refusal = admitRuntimeGraphDelta(
            createPorts(projectValidator, topologyValidator),
            { appRevision: 3, projectRevision: 'p-7' },
            NODES,
            'delta'
        );

        expect(refusal).toBeUndefined();
        expect(projectValidator).toHaveBeenCalledExactlyOnceWith('p-7');
        expect(topologyValidator).toHaveBeenCalledExactlyOnceWith(NODES);
    });

    it('skips unregistered validators', () => {
        expect(
            admitRuntimeGraphDelta(createPorts(null, null), { appRevision: 3, projectRevision: 'p' }, NODES, 'delta')
        ).toBeUndefined();
    });

    it('refuses a stale engine revision before consulting either validator', () => {
        const projectValidator = vi.fn(() => true);
        const topologyValidator = vi.fn(() => true);

        const refusal = admitRuntimeGraphDelta(
            createPorts(projectValidator, topologyValidator),
            { appRevision: 2, projectRevision: 'p' },
            NODES,
            'initialization'
        );

        expect(refusal).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph initialization is stale for the live engine revision',
        });
        expect(projectValidator).not.toHaveBeenCalled();
        expect(topologyValidator).not.toHaveBeenCalled();
    });

    it('refuses a stale project revision before consulting the topology validator', () => {
        const topologyValidator = vi.fn(() => true);

        const refusal = admitRuntimeGraphDelta(
            createPorts(() => false, topologyValidator),
            { appRevision: 3, projectRevision: 'p' },
            NODES,
            'delta'
        );

        expect(refusal).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta is stale for the current project revision',
        });
        expect(topologyValidator).not.toHaveBeenCalled();
    });

    it('refuses with the thrown error when a validator throws', () => {
        const projectThrow = admitRuntimeGraphDelta(
            createPorts(() => {
                throw new Error('no document');
            }, null),
            { appRevision: 3, projectRevision: 'p' },
            NODES,
            'delta'
        );
        const topologyThrow = admitRuntimeGraphDelta(
            createPorts(null, () => {
                throw new Error('no tracks');
            }),
            { appRevision: 3, projectRevision: 'p' },
            NODES,
            'initialization'
        );

        expect(projectThrow).toMatchObject({
            reason: 'Runtime graph delta project revision validation failed: Error: no document',
        });
        expect(topologyThrow).toMatchObject({
            reason: 'Runtime graph initialization topology validation failed: Error: no tracks',
        });
    });

    it('refuses a topology the project does not hold', () => {
        expect(
            admitRuntimeGraphDelta(
                createPorts(
                    () => true,
                    () => false
                ),
                { appRevision: 3, projectRevision: 'p' },
                NODES,
                'delta'
            )
        ).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta does not match the current project topology',
        });
    });
});
