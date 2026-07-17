import type { Track } from '#/modules/Arrangement/stores';

// Shared value shapes for the template builder helpers. Types only — no
// function values, so the one-function-per-file rule does not apply.

export type Device = Track['devices'][number];

export type DeviceSpec = { type: string; name?: string; params?: Record<string, number> };

export type VcaGroupHandle = {
    id: string;
    name: string;
    memberTrackIds: string[];
};
