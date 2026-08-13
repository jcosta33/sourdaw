import { describe, it, expect } from 'vitest';

import { PUSH_2_PROFILE } from '../../models/ControllerProfile';
import { hardwareControllerStore } from '../hardwareControllerStore';

describe('hardwareControllerStore', () => {
    it('seeds the built-in Push 2 profile so importHardwareMappings has a known profileId to target out of the box (F-8)', () => {
        const profileIds = hardwareControllerStore.value?.profiles.map((profile) => profile.id);
        expect(profileIds).toContain(PUSH_2_PROFILE.id);
    });
});
