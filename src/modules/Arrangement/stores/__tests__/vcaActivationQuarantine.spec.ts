import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function productionSources(root = resolve(process.cwd(), 'src')): Array<{ path: string; text: string }> {
    const files: Array<{ path: string; text: string }> = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__') {
                files.push(...productionSources(path));
            }
            continue;
        }
        if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
            files.push({ path: relative(process.cwd(), path), text: readFileSync(path, 'utf8') });
        }
    }
    return files;
}

function matches(text: string, pattern: RegExp): string[] {
    return text.match(pattern) ?? [];
}

const LEGACY_ACTIONS = ['createVcaGroup', 'assignToVca', 'removeFromVca', 'setVcaGain'] as const;

describe('VCA activation quarantine', () => {
    it('keeps vca outside the production TrackKind contract', () => {
        const trackModel = source('src/modules/Arrangement/models/Track.ts');
        const declaration = trackModel.match(/export type TrackKind = ([^;]+);/);

        expect(declaration).not.toBeNull();
        expect(declaration?.[1]).toBe("'audio' | 'midi' | 'bus' | 'master' | 'folder'");
    });

    it('keeps the dormant migration definition-only in production source', () => {
        const occurrences = productionSources().flatMap(({ path, text }) =>
            matches(text, /\bmigrateLegacyVcaGroups\b/g).map(() => path)
        );

        expect(occurrences).toEqual([
            'src/modules/Project/useCases/projectPersistence/helpers/migrateLegacyVcaGroups.ts',
        ]);
    });

    it('keeps every legacy writer registered and called by its allowed handler', () => {
        const handlers = source('src/modules/Arrangement/useCases/getArrangementHandlers.ts');
        const expectedHandlerByAction = {
            assignToVca: 'handleAssignToVca',
            createVcaGroup: 'handleCreateVcaGroup',
            removeFromVca: 'handleRemoveFromVca',
            setVcaGain: 'handleSetVcaGain',
        } as const;

        for (const action of LEGACY_ACTIONS) {
            const handler = expectedHandlerByAction[action];
            const handlerSource = source(`src/modules/Arrangement/handlers/vca/${handler}.ts`);

            expect(matches(handlers, new RegExp(`\\b${action}: ${handler}\\b`, 'g'))).toHaveLength(1);
            expect(matches(handlerSource, new RegExp(`\\b${action}\\(`, 'g'))).toHaveLength(1);
        }
    });

    it('keeps the legacy assignment reader mounted with exact live writer calls', () => {
        const inspector = source('src/modules/TimelineEditor/presentations/views/Inspector/TrackInspector.tsx');
        const reader = source('src/modules/TimelineEditor/presentations/views/Inspector/TrackVcaSection.tsx');

        expect(matches(inspector, /import \{ TrackVcaSection \} from '\.\/TrackVcaSection';/g)).toHaveLength(1);
        expect(matches(inspector, /<TrackVcaSection track=\{track\} \/>/g)).toHaveLength(1);
        expect(matches(reader, /useStore\(vcaGroupStore, defaultVcaGroupState\)/g)).toHaveLength(1);
        expect(matches(reader, /createVcaGroup\(name, \[track\.id\]\)/g)).toHaveLength(1);
        expect(matches(reader, /assignToVca\(track\.id, val\)/g)).toHaveLength(1);
        expect(matches(reader, /removeFromVca\(track\.id\)/g)).toHaveLength(1);
    });

    it('keeps only legacy VCA actions in the registered and persisted action unions', () => {
        const handlers = source('src/modules/Arrangement/useCases/getArrangementHandlers.ts');
        const appActions = source('src/utils/handlerContract.ts');
        const runtimeActions = source('src/modules/AiRuntime/models/RuntimeAction.ts');
        const registeredVcaActions = matches(handlers, /^\s{8}(\w*Vca\w*):/gm).map((row) => row.trim().split(':')[0]);
        const persistedVcaActions = matches(appActions, /type: '([^']*Vca[^']*)'/g).map(
            (row) => row.match(/'([^']+)'/)?.[1]
        );
        const runtimeVcaActions = matches(runtimeActions, /type: '([^']*Vca[^']*)'/g).map(
            (row) => row.match(/'([^']+)'/)?.[1]
        );

        expect(registeredVcaActions).toEqual([
            'createVcaGroup',
            'assignToVca',
            'removeFromVca',
            'setVcaGain',
            'restoreLegacyVcaState',
        ]);
        expect(persistedVcaActions).toEqual([
            'createVcaGroup',
            'assignToVca',
            'removeFromVca',
            'setVcaGain',
            'restoreLegacyVcaState',
        ]);
        expect(runtimeVcaActions).toEqual(LEGACY_ACTIONS);
    });

    it('keeps project and hydration schemas closed to canonical VCA tracks', () => {
        const projectModel = source('src/modules/Project/models/ProjectData.ts');
        const projectStore = source('src/modules/Project/stores/arrangementStore.ts');
        const hydration = source('src/modules/Project/useCases/projectPersistence/helpers/isHydratableProjectData.ts');
        const expectedKindUnion = "'audio' | 'midi' | 'bus' | 'master' | 'folder'";

        expect(projectModel.match(/export type ProjectTrackKind = ([^;]+);/)?.[1]).toBe(expectedKindUnion);
        expect(projectStore.match(/export type ProjectTrackKind = ([^;]+);/)?.[1]).toBe(expectedKindUnion);
        expect(
            matches(hydration, /\['audio', 'midi', 'bus', 'master', 'folder'\]\.includes\(String\(value\.kind\)\)/g)
        ).toHaveLength(1);
    });

    it('keeps dormant migration foundations unreachable from activation entry points', () => {
        const activationEntryPoints = [
            'src/app/bootstrap.ts',
            'src/modules/Arrangement/useCases/getArrangementHandlers.ts',
            'src/modules/Project/useCases/projectPersistence/fileIO/hydrateArrangementTracks.ts',
            'src/modules/Project/useCases/projectPersistence/fileIO/serializeArrangementTracks.ts',
            'src/modules/Project/useCases/projectPersistence/helpers/isHydratableProjectData.ts',
            'src/modules/TimelineEditor/presentations/views/Inspector/TrackInspector.tsx',
        ] as const;

        expect(activationEntryPoints).toHaveLength(6);
        for (const path of activationEntryPoints) {
            const text = source(path);
            expect(matches(text, /migrateLegacyVcaGroups|VcaTrackMigration/g), path).toHaveLength(0);
        }
    });
});
