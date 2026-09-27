import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../DeviceParameter';
import { YEAST_DESCRIPTOR } from '../YeastDescriptor';

/**
 * The arpeggiator (and every other rack processor) is configured per rack
 * processor id through the Yeast panel's `setYeastProcessorParam` action, so
 * the device descriptor declares nothing: a device parameter here would be
 * advertised as automatable and planner-discoverable while no runtime path
 * read it (#4650). These pins hold the surface to that decision — a re-added
 * `arp_*` parameter without a real write path fails here.
 */
describe('YEAST_DESCRIPTOR', () => {
    it('stays a registered custom-UI device — the Yeast panel is its configuration surface', () => {
        expect(getPluginById('yeast')).toBe(YEAST_DESCRIPTOR);
        expect(YEAST_DESCRIPTOR.hasCustomUI).toBe(true);
        expect(YEAST_DESCRIPTOR.category).toBe('effect');
    });

    it('declares no device parameters — rack processors are addressed by processor id, not device parameter id', () => {
        expect(YEAST_DESCRIPTOR.parameters).toEqual([]);
    });

    it('declares none of the former arp parameters the device route never honoured', () => {
        const declaredIds = YEAST_DESCRIPTOR.parameters.map((parameter) => parameter.id);
        for (const inert of ['arp_mode', 'arp_rate', 'arp_gate', 'arp_swing']) {
            expect(declaredIds).not.toContain(inert);
        }
    });
});
