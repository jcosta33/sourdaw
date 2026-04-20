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

const mockInstance = (id: string): WAMInstance => ({
    descriptor,
    audioNode: {} as AudioNode,
    initialized: true,
    groupId: id,
});

describe('getActiveInstances', () => {
    beforeEach(() => {
        instances.clear();
    });

    it('should return a shallow copy of the instances map', () => {
        instances.set('a', mockInstance('g1'));
        const a = getActiveInstances();
        const b = getActiveInstances();
        expect(a).not.toBe(b);
        expect(a.get('a')?.groupId).toBe('g1');
    });

    it('should reflect mutations to the backing map', () => {
        const map = getActiveInstances();
        expect(map.size).toBe(0);
        instances.set('x', mockInstance('gx'));
        expect(getActiveInstances().size).toBe(1);
    });
});
