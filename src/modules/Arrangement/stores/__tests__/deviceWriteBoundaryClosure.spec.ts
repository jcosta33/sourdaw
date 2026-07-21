import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

type CountByPath = Readonly<Record<string, number>>;

const EXPECTED_RUNTIME_COUNTS: CountByPath = {
    'src/modules/Arrangement/stores/persistDeviceParam.ts': 1,
    'src/modules/Arrangement/useCases/device/addDevice.ts': 1,
    'src/modules/Arrangement/useCases/device/setDeviceParameter/persistDevicePatch.ts': 1,
    'src/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter.ts': 1,
    'src/modules/Arrangement/useCases/preset/presetLoading.ts': 2,
    'src/modules/Arrangement/useCases/setTrackGainPan/helpers.ts': 1,
    'src/modules/AudioEngine/models/AudioEngineState.ts': 2,
    'src/modules/AudioEngine/repositories/createWebAudioEngine.ts': 2,
    'src/modules/AudioEngine/useCases/deviceControls/updateDeviceParam.ts': 2,
    'src/modules/AudioEngine/useCases/deviceControls/updateDevicePatch.ts': 2,
    'src/modules/Automation/useCases/modulation/applyModulationToEngine.ts': 1,
    'src/modules/Automation/useCases/modulation/revertMappingsToBase.ts': 1,
    'src/modules/Crust/useCases/crustParamBridge/createFlushHandlers.ts': 4,
    'src/modules/Fermenter/useCases/fermenterParamBridge/loadFermenterPatchWithAudio.ts': 2,
    'src/modules/Fermenter/useCases/fermenterParamBridge/setFermenterParamWithAudio.ts': 2,
    'src/modules/Fermenter/useCases/presetMorph/applyMorphedPatch.ts': 2,
    'src/modules/Gluten/useCases/glutenParamBridge/createFlushHandlers.ts': 4,
    'src/modules/Levain/useCases/levainParamBridge/helpers.ts': 1,
    'src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts': 1,
    'src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts': 1,
    'src/modules/Proof/useCases/proofParamBridge/setProofParam.ts': 1,
    'src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts': 2,
    'src/modules/Proof/useCases/proofParamBridge/setProofTarget.ts': 1,
    'src/modules/Transport/useCases/ensureTrackStrips.ts': 1,
    'src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts': 1,
};

const EXPECTED_ADD_COUNTS: CountByPath = {
    'src/modules/Arrangement/useCases/device/addDevice.ts': 1,
    'src/modules/Arrangement/useCases/device/addExternalDevice.ts': 1,
    'src/modules/Arrangement/useCases/preset/presetLoading.ts': 1,
    'src/modules/AudioEngine/models/AudioEngineState.ts': 1,
    'src/modules/AudioEngine/repositories/createWebAudioEngine.ts': 1,
    'src/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip.ts': 2,
    'src/modules/GrandBoule/useCases/createGrandBouleTrack.ts': 1,
    'src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts': 2,
    'src/modules/Toaster/useCases/createDrumTrackStack.ts': 1,
    'src/modules/Transport/useCases/ensureTrackStrips.ts': 1,
};

const GUARDED_EXECUTABLE_PATHS = [
    'src/modules/Arrangement/stores/persistDeviceParam.ts',
    'src/modules/Arrangement/useCases/device/setDeviceParameter/persistDevicePatch.ts',
    'src/modules/Arrangement/useCases/device/setDeviceParameter/setDeviceParameter.ts',
    'src/modules/Arrangement/useCases/setTrackGainPan/helpers.ts',
    'src/modules/Automation/useCases/modulation/applyModulationToEngine.ts',
    'src/modules/Automation/useCases/modulation/revertMappingsToBase.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/createFlushParam.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts',
    'src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaParamWithAudio.ts',
    'src/modules/Crust/useCases/crustParamBridge/createFlushHandlers.ts',
    'src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts',
    'src/modules/Crust/useCases/crustParamBridge/setCrustParamWithAudio.ts',
    'src/modules/Fermenter/useCases/fermenterParamBridge/loadFermenterPatchWithAudio.ts',
    'src/modules/Fermenter/useCases/fermenterParamBridge/setFermenterParamWithAudio.ts',
    'src/modules/Fermenter/useCases/presetMorph/applyMorphedPatch.ts',
    'src/modules/Gluten/useCases/glutenParamBridge/createFlushHandlers.ts',
    'src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts',
    'src/modules/Gluten/useCases/glutenParamBridge/setGlutenParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/createFlushParam.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/recallGrinderSnapshotWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/setGrinderMicParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts',
    'src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts',
    'src/modules/Levain/useCases/levainParamBridge/helpers.ts',
    'src/modules/Levain/useCases/loadPreset.ts',
    'src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts',
    'src/modules/Proof/useCases/proofParamBridge/setProofParam.ts',
    'src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts',
    'src/modules/Proof/useCases/proofParamBridge/setProofTarget.ts',
    'src/modules/Proof/useCases/proofParamBridge/syncFullPatch.ts',
    'src/modules/Toaster/useCases/setPadParamImmediate.ts',
    'src/modules/Toaster/useCases/toasterParamBridge/setPadEngineImmediate.ts',
    'src/modules/Toaster/useCases/toasterParamBridge/setToasterKitParam.ts',
    'src/modules/Toaster/useCases/toasterParamBridge/setToasterPadParam.ts',
    'src/modules/Transport/useCases/ensureTrackStrips.ts',
    'src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts',
] as const;

function productionSources(root: string): Array<{ path: string; source: string }> {
    const files: Array<{ path: string; source: string }> = [];
    function visit(directory: string): void {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== '__tests__') {
                    visit(absolutePath);
                }
                continue;
            }
            if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) {
                continue;
            }
            files.push({ path: relative(root, absolutePath), source: readFileSync(absolutePath, 'utf8') });
        }
    }
    visit(join(root, 'src'));
    return files;
}

function countByPath(
    files: ReadonlyArray<{ path: string; source: string }>,
    pattern: RegExp
): Record<string, number> {
    const result: Record<string, number> = {};
    for (const file of files) {
        const matches = file.source.match(pattern);
        if (matches && matches.length > 0) {
            result[file.path] = matches.length;
        }
    }
    return result;
}

describe('device write boundary closure', () => {
    it('keeps every direct persistence, runtime, and strip-add row classified by path and count', () => {
        const files = productionSources(process.cwd());
        expect(
            countByPath(
                files,
                /\b(?:persistDeviceParam|persistDevicePatch|updateDeviceParam|updateDevicePatch)\(/g
            )
        ).toEqual(EXPECTED_RUNTIME_COUNTS);
        expect(countByPath(files, /\baddDeviceToStrip\(/g)).toEqual(EXPECTED_ADD_COUNTS);

        const sourceByPath = new Map(files.map((file) => [file.path, file.source]));
        for (const path of GUARDED_EXECUTABLE_PATHS) {
            expect(sourceByPath.get(path), path).toContain('resolveEligibleDeviceWriteTarget');
        }
    });

    it('freezes executable Arrangement and Project device-data rows', () => {
        const files = productionSources(process.cwd()).filter(
            (file) =>
                file.path.startsWith('src/modules/Arrangement/') || file.path.startsWith('src/modules/Project/')
        );
        const rows = Object.values(countByPath(files, /\b(?:parameterValues|devices)\s*:/g));
        expect(rows.reduce((total, count) => total + count, 0)).toBe(287);
    });

    it('falsifies an unclassified caller or direct project-device row', () => {
        const runtime = countByPath(
            [{ path: 'src/modules/Unexpected/newWriter.ts', source: 'updateDeviceParam("t", "d", "p", 1);' }],
            /\b(?:persistDeviceParam|persistDevicePatch|updateDeviceParam|updateDevicePatch)\(/g
        );
        const projectWrite = countByPath(
            [{ path: 'src/modules/Arrangement/newWriter.ts', source: 'const next = { devices: [] };' }],
            /\b(?:parameterValues|devices)\s*:/g
        );
        expect(runtime).not.toEqual(EXPECTED_RUNTIME_COUNTS);
        expect(projectWrite).toEqual({ 'src/modules/Arrangement/newWriter.ts': 1 });
    });
});
