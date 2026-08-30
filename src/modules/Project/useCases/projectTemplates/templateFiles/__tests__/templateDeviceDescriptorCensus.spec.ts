/**
 * Device-type census over every project template file.
 *
 * A template track whose `device.type` resolves to no descriptor ships degraded:
 * the engine finds no parameters and no contract for it, whatever the template
 * author intended. That is exactly the shape of writing a factory preset id
 * (e.g. `factory-bass-sub`) into `deviceType` — the id names a SoundPreset, not
 * a plugin — so this spec refuses it by resolving every device of every track
 * every template finalizes against the same registries the app resolves
 * against: the plugin descriptor registry (`getPluginById`) and the registered
 * Faust DSP modules (`isFaustModule`, populated by the same registrations app
 * initialization performs).
 *
 * Template files are discovered by glob so a newly added file joins the census
 * without being registered here.
 */

import { describe, expect, it, vi } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';
import { registerBuiltinFaustDSP, isFaustModule } from '#/modules/PluginHost/useCases';
import { registerProSynthInstruments } from '#/modules/Synth/useCases';

import type { Track } from '#/modules/Arrangement/stores';

const finalizedTrackLists: Track[][] = [];

vi.mock('../../templateHelpers/finalizeTemplate', () => ({
    finalizeTemplate: vi.fn(async (input: { tracks: Track[] }) => {
        finalizedTrackLists.push(input.tracks);
    }),
}));

// Direct children of templateFiles/ only: `*` does not cross into `__tests__/`.
const templateFileModules = import.meta.glob('../*.ts', { eager: true });

registerBuiltinFaustDSP();
registerProSynthInstruments();

type TemplateCreate = () => Promise<void>;

function isTemplateCreate(value: unknown): value is TemplateCreate {
    return typeof value === 'function';
}

function templateCreateFunctions(): Array<{ fileName: string; create: TemplateCreate }> {
    return Object.entries(templateFileModules).map(([fileName, module]) => {
        const creates = Object.values(module).filter(isTemplateCreate);
        if (creates.length !== 1) {
            throw new Error(`${fileName} must export exactly one template create function, found ${creates.length}`);
        }
        return { fileName, create: creates[0] };
    });
}

function resolvesToDescriptor(deviceType: string): boolean {
    return getPluginById(deviceType) !== undefined || isFaustModule(deviceType);
}

describe('project template device descriptor census', () => {
    it('resolves every device of every template file to a known descriptor', async () => {
        const templates = templateCreateFunctions();
        expect(templates).not.toHaveLength(0);

        const failures: string[] = [];
        for (const { fileName, create } of templates) {
            finalizedTrackLists.length = 0;
            await create();

            if (finalizedTrackLists.length !== 1) {
                failures.push(`${fileName}: finalized ${finalizedTrackLists.length} track lists, expected 1`);
                continue;
            }
            const unresolved = (finalizedTrackLists[0] ?? []).flatMap((track) =>
                track.devices
                    .filter((device) => !resolvesToDescriptor(device.type))
                    .map((device) => `${track.name} / ${device.name}: ${device.type}`)
            );
            if (unresolved.length > 0) {
                failures.push(`${fileName}: ${unresolved.join(', ')}`);
            }
        }
        expect(failures.join('\n'), 'template devices that resolve to no descriptor').toBe('');
    });
});
