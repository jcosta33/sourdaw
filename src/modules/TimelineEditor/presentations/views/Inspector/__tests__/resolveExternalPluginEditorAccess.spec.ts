import { describe, expect, it } from 'vitest';

import { isSupportedPluginFormat } from '#/modules/PluginHost/useCases';

import { type Device } from '../../../../models/TrackViewTypes';
import { resolveExternalPluginEditorAccess, type SupportedScannedPlugin } from '../resolveExternalPluginEditorAccess';

type ScannedEntry = SupportedScannedPlugin & { format: string };

const clap: ScannedEntry = {
    id: 'reverb-plugin',
    descriptor_id: 'com.vendor.reverb',
    format: 'clap',
    has_custom_ui: true,
};
const device = (overrides: Partial<Device> = {}): Pick<Device, 'externalPluginId' | 'externalInstanceId'> => ({
    externalPluginId: 'reverb-plugin',
    externalInstanceId: 'instance-1',
    ...overrides,
});
const active = { 'instance-1': { status: 'active' as const } };
const supported = (scanned: readonly ScannedEntry[]): ScannedEntry[] =>
    scanned.filter((plugin) => isSupportedPluginFormat(plugin.format));

describe('resolveExternalPluginEditorAccess', () => {
    it.each([
        {
            case: 'an active plugin with an editor',
            plugins: [clap],
            device: device(),
            activations: active,
            expected: 'openable',
        },
        {
            case: 'a plugin matched by its descriptor id',
            plugins: [clap],
            device: device({ externalPluginId: 'com.vendor.reverb' }),
            activations: active,
            expected: 'openable',
        },
        {
            case: 'an active plugin whose editor capability is unqueried',
            plugins: [{ ...clap, has_custom_ui: false, capability_metadata_reason: 'scan timed out' }],
            device: device(),
            activations: active,
            expected: 'openable',
        },
        {
            case: 'an active plugin the scan reports has no editor',
            plugins: [{ ...clap, has_custom_ui: false }],
            device: device(),
            activations: active,
            expected: 'no-editor',
        },
        {
            case: 'a plugin still loading',
            plugins: [clap],
            device: device(),
            activations: { 'instance-1': { status: 'loading' as const } },
            expected: 'not-loaded',
        },
        {
            case: 'a plugin whose activation failed',
            plugins: [clap],
            device: device(),
            activations: { 'instance-1': { status: 'error' as const, message: 'refused' } },
            expected: 'not-loaded',
        },
        {
            case: 'a device with no activation entry',
            plugins: [clap],
            device: device(),
            activations: {},
            expected: 'not-loaded',
        },
        {
            case: 'a device with no instance id',
            plugins: [clap],
            device: device({ externalInstanceId: undefined }),
            activations: active,
            expected: 'not-loaded',
        },
        {
            case: 'a device with no plugin id',
            plugins: [clap],
            device: device({ externalPluginId: undefined }),
            activations: active,
            expected: 'not-loaded',
        },
        {
            case: 'a plugin missing from the scan',
            plugins: [clap],
            device: device({ externalPluginId: 'unscanned-plugin' }),
            activations: active,
            expected: 'not-loaded',
        },
        {
            case: 'a plugin in an unsupported format',
            plugins: [{ ...clap, format: 'lv2' }],
            device: device(),
            activations: active,
            expected: 'not-loaded',
        },
    ])('$case is $expected', ({ plugins, device: target, activations, expected }) => {
        expect(resolveExternalPluginEditorAccess(target, supported(plugins), activations)).toBe(expected);
    });
});
