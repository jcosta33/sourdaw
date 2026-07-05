import { describe, it, expect } from 'vitest';

import { getDefaultPadNames } from '../getDefaultPadNames';
import { getToasterPresetKit } from '../getToasterPresetKit';
import { getToasterPresetSummaries } from '../getToasterPresetSummaries';
import { getToasterPresets } from '../toasterQueries';

describe('toasterQueries', () => {
    it('should return the default pad names as a defensive snapshot', () => {
        const padNames = getDefaultPadNames();
        padNames[0] = 'Mutated Kick';

        expect(getDefaultPadNames()).toEqual([
            'Kick',
            'Snare',
            'Closed HH',
            'Open HH',
            'Clap',
            'Rim',
            'Low Tom',
            'Mid Tom',
            'Hi Tom',
            'Crash',
            'Ride',
            'Cowbell',
            'Clave',
            'Shaker',
            'Perc 1',
            'Perc 2',
        ]);
    });

    it('should return toaster preset tags as defensive snapshots', () => {
        const presets = getToasterPresets();
        const firstPreset = presets[0];
        if (!firstPreset) {
            throw new Error('Expected at least one Toaster preset.');
        }

        firstPreset.tags[0] = 'mutated';

        const freshFirstPreset = getToasterPresets()[0];
        if (!freshFirstPreset) {
            throw new Error('Expected at least one Toaster preset.');
        }

        expect(freshFirstPreset.tags).toEqual(['toaster', 'init']);
    });

    it('should return toaster preset summaries without kit payloads', () => {
        const summaries = getToasterPresetSummaries();
        const firstSummary = summaries[0];
        if (!firstSummary) {
            throw new Error('Expected at least one Toaster preset summary.');
        }

        firstSummary.tags[0] = 'mutated';

        expect('kit' in firstSummary).toBe(false);
        expect(getToasterPresetSummaries()[0]?.tags).toEqual(['toaster', 'init']);
    });

    it('should return toaster preset kit data as defensive snapshots', () => {
        const classicKit = getToasterPresetKit('808-classic');

        const classicKick = classicKit?.pads[0];
        if (!classicKick) {
            throw new Error('Expected the classic 808 Toaster preset to include a kick pad.');
        }

        classicKick.engineParams.base_freq = 999;
        classicKick.name = 'Mutated Kick';

        const freshClassicKick = getToasterPresetKit('808-classic')?.pads[0];
        if (!freshClassicKick) {
            throw new Error('Expected the classic 808 Toaster preset to include a kick pad.');
        }

        expect(freshClassicKick.engineParams.base_freq).toBe(50);
        expect(freshClassicKick.name).toBe('Kick');
    });

    it('should return null for an unknown toaster preset kit', () => {
        expect(getToasterPresetKit('missing')).toBeNull();
    });
});
