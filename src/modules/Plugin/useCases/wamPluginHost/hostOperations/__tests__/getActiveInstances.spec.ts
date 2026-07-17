import { describe, it, expect, beforeEach } from 'vitest';

import { type WAMDescriptor, type WAMInstance } from '#/modules/Plugin/models/WamPluginHostTypes';

import { getActiveInstances } from '../getActiveInstances';
import { instances } from '../helpers';

const descriptor: WAMDescriptor = {
    id: 'd1',
    name: 'D',
    vendor: 'V',
    version: '1',
    category: 'effect',
    sdkVersion: '2.0',
};

function mockInstance(id: string): WAMInstance {
    return {
        instanceId: `instance-${id}`,
        descriptor,
        audioNode: {} as AudioNode,
        initialized: true,
        groupId: id,
    };
}

describe('getActiveInstances', () => {
    beforeEach(() => {
        instances.clear();
    });

    it('should return a shallow copy of the instances map', () => {
        instances.set('a', mockInstance('g1'));
        const alpha = getActiveInstances();
        const b = getActiveInstances();
        expect(alpha).not.toBe(b);
        expect(alpha.get('a')?.groupId).toBe('g1');
    });

    it('should reflect mutations to the backing map', () => {
        const map = getActiveInstances();
        expect(map.size).toBe(0);
        instances.set('x', mockInstance('gx'));
        expect(getActiveInstances().size).toBe(1);
    });
});
