import { describe, expect, it } from 'vitest';

import { collaborationPresets, filePresets } from '../FileAndCollaboration';
import { automationPresets, mixPresets } from '../MixAndAutomation';
import { type PresetContext } from '../Types';
import { workspacePresets } from '../Workspace';

const emptyCtx: PresetContext = {
    selectedTrackId: undefined,
    selectedClipId: undefined,
    selectedClipType: undefined,
    trackCount: 0,
};

describe('mixPresets', () => {
    it('builds the expected action type for each mix preset', () => {
        const expected: Record<string, string> = {
            'analyze-mix': 'analyzeMix',
            'autofix-mix': 'autoFixMix',
            'consolidate-all': 'consolidateAllTracks',
            'latency-report': 'getLatencyReport',
        };
        for (const preset of mixPresets) {
            const action = preset.buildAction(emptyCtx);
            const expectedType = expected[preset.id];
            if (!expectedType) {
                throw new Error(`No expected type for ${preset.id}`);
            }
            if (action === null || Array.isArray(action)) {
                throw new Error(`Expected single action for ${preset.id}`);
            }
            expect(action.type).toBe(expectedType);
        }
    });
});

describe('automationPresets', () => {
    it('deliberately returns null from buildAction to block the legacy fuzzy fast path', () => {
        // These presets are searchable but intentionally non-executable — parameter
        // and target grounding belong to the provider tool bridge, not the preset.
        for (const preset of automationPresets) {
            const action = preset.buildAction({ ...emptyCtx, selectedTrackId: 't1', trackCount: 1 });
            expect(action).toBeNull();
        }
    });
});

describe('filePresets', () => {
    it('builds the expected action type for each file preset', () => {
        const expected: Record<string, string> = {
            'scan-plugins': 'scanPlugins',
            undo: 'undo',
            redo: 'redo',
        };
        for (const preset of filePresets) {
            const action = preset.buildAction(emptyCtx);
            const expectedType = expected[preset.id];
            if (!expectedType) {
                throw new Error(`No expected type for ${preset.id}`);
            }
            if (action === null || Array.isArray(action)) {
                throw new Error(`Expected single action for ${preset.id}`);
            }
            expect(action.type).toBe(expectedType);
        }
    });
});

describe('collaborationPresets', () => {
    it('builds a createCollabSession action with the host name payload', () => {
        const action = collaborationPresets[0]!.buildAction(emptyCtx);
        if (action === null || Array.isArray(action)) {
            throw new Error('Expected single action');
        }
        expect(action.type).toBe('createCollabSession');
        expect(action.payload).toEqual({ name: 'Host' });
    });
});

describe('workspacePresets', () => {
    it('builds the expected action type for each workspace preset', () => {
        const expected: Record<string, string> = {
            'view-arrange': 'setWorkspaceMode',
            'view-clip': 'setWorkspaceMode',
            'view-mix': 'openMixer',
            'open-mixer': 'openMixer',
            'close-mixer': 'closeMixer',
            'toggle-sidebar': 'toggleSidebar',
            'toggle-inspector': 'toggleInspector',
            'toggle-chat': 'toggleChatPanel',
            'zoom-fit': 'zoomToFit',
            'zoom-selection': 'zoomToSelection',
            preferences: 'openPreferencesDialog',
        };
        for (const preset of workspacePresets) {
            const action = preset.buildAction(emptyCtx);
            const expectedType = expected[preset.id];
            if (!expectedType) {
                throw new Error(`No expected type for ${preset.id}`);
            }
            if (action === null || Array.isArray(action)) {
                throw new Error(`Expected single action for ${preset.id}`);
            }
            expect(action.type).toBe(expectedType);
        }
    });

    it('routes view-arrange and view-clip to the correct workspace mode payload', () => {
        const arrange = workspacePresets.find((p) => p.id === 'view-arrange')!;
        const clip = workspacePresets.find((p) => p.id === 'view-clip')!;
        const arrangeAction = arrange.buildAction(emptyCtx);
        const clipAction = clip.buildAction(emptyCtx);
        if (arrangeAction === null || Array.isArray(arrangeAction)) {
            throw new Error('Expected arrange action');
        }
        if (clipAction === null || Array.isArray(clipAction)) {
            throw new Error('Expected clip action');
        }
        expect(arrangeAction.payload).toEqual({ mode: 'arrange' });
        expect(clipAction.payload).toEqual({ mode: 'clip' });
    });
});
