import { inject } from '#/infra/di/inject';
import { stopPlayback, seekPlayhead } from '#/modules/Transport/useCases';

import { duplicateTrack } from '../trackShortcuts/duplicateTrack';

import { workspaceStore } from '#/modules/Workspace/stores';

import {
    cycleAutomationVisibility,
    toggleCommandPalette,
    selectAllClips,
    clearClipSelection,
    toggleWorkspaceMode,
    setEditingTool,
    type EditingTool,
    TOOL_SHORTCUTS,
} from '#/modules/Workspace/useCases';

import { trackStore, zoomTimeline } from '#/modules/Arrangement/stores';
import { getAllClipIds } from '../../selectionHelpers/getAllClipIds';
import { getLastClipEndBeat } from '../../selectionHelpers/getLastClipEndBeat';
import { goToNextMarker } from '../../selectionHelpers/goToNextMarker';
import { goToPreviousMarker } from '../../selectionHelpers/goToPreviousMarker';
import { eventBus } from '#/app/registerDependencies';
import { shortcutStore, type ShortcutAction } from '../../../stores/shortcutStore';
import { executeAppAction } from '../../executeAppAction';

const ZOOM_STEP = 4;

const NUMBER_TOOL_MAP: Record<string, EditingTool> = {
    '1': 'select',
    '2': 'cut',
    '3': 'draw',
    '4': 'automation',
    '5': 'stretch',
};

export type KeyDescriptor = {
    key: string;
    mod: boolean;
    shift: boolean;
    alt: boolean;
    repeat: boolean;
    isInput: boolean;
};

function matches(desc: KeyDescriptor, keys: string[]): boolean {
    return keys.some((combo) => {
        const parts = combo.split('+');
        const keyPart = parts.pop();
        if (!keyPart) {
            return false;
        }

        const hasMod = parts.includes('mod');
        const hasShift = parts.includes('shift');
        const hasAlt = parts.includes('alt');

        const normalizedKey = keyPart === 'Space' ? ' ' : keyPart;
        const eventKey = desc.key;

        // Simple match for exact key or case-insensitive character match
        const keyMatch =
            normalizedKey === eventKey ||
            (normalizedKey.length === 1 &&
                eventKey.length === 1 &&
                normalizedKey.toLowerCase() === eventKey.toLowerCase());

        return keyMatch && hasMod === desc.mod && hasShift === desc.shift && hasAlt === desc.alt;
    });
}

/**
 * Handles a keydown event by mapping it to the appropriate action.
 * Returns `true` if the caller should call `preventDefault()`.
 */
export const handleKeydown = inject({ eventBus, executeAppAction })(
    ({ eventBus, executeAppAction }) => {
        const executeShortcutAction = (action: ShortcutAction): boolean => {
            if (action.type === 'appAction') {
                const { type, payload } = action.action;

                // Handle dynamic payloads
                if (type === 'duplicateClip' && (payload as any)?.clipId === 'selected') {
                    const selectedClipId = workspaceStore.value?.selectedClipId;
                    if (selectedClipId) {
                        executeAppAction({ type: 'duplicateClip', payload: { clipId: selectedClipId } });
                    }
                    return true;
                }
                if (type === 'duplicateClipToNextBar' && (payload as any)?.clipId === 'selected') {
                    const selectedClipId = workspaceStore.value?.selectedClipId;
                    if (selectedClipId) {
                        executeAppAction({ type: 'duplicateClipToNextBar', payload: { clipId: selectedClipId } });
                    }
                    return true;
                }

                executeAppAction(action.action);
                return true;
            }
            if (action.type === 'callback') {
                switch (action.id) {
                    case 'stopPlayback': {
                        const ws = workspaceStore.value;
                        if (ws && (ws.selectedClipIds.length > 0 || ws.selectedClipId)) {
                            clearClipSelection();
                        } else {
                            stopPlayback();
                        }
                        return false;
                    }
                    case 'zoomIn':
                        zoomTimeline(ZOOM_STEP);
                        return true;
                    case 'zoomOut':
                        zoomTimeline(-ZOOM_STEP);
                        return true;
                    case 'toggleCommandPalette':
                        toggleCommandPalette();
                        return true;
                    case 'selectAllClips':
                        selectAllClips(getAllClipIds);
                        return true;
                    case 'clearClipSelection':
                        clearClipSelection();
                        return true;
                    case 'duplicateTrack': {
                        const selectedId = trackStore.value?.selectedTrackId;
                        if (selectedId) {
                            duplicateTrack(selectedId);
                        }
                        return true;
                    }
                    case 'cycleAutomationVisibility':
                        cycleAutomationVisibility();
                        return false;
                    case 'toggleWorkspaceMode':
                        toggleWorkspaceMode();
                        return true;
                    default:
                        return false;
                }
            }
            return false;
        };

        const handleSimpleKeys = (key: string, desc: KeyDescriptor): boolean => {
            // Check shortcut store first
            const { definitions, customMappings } = shortcutStore.value ?? {
                definitions: [],
                customMappings: {},
            };
            for (const def of definitions) {
                const keys = customMappings[def.id] ?? def.defaultKeys;
                if (matches(desc, keys)) {
                    return executeShortcutAction(def.action);
                }
            }

            switch (key) {
                case 'L':
                    eventBus.emit('zoom.scrollToPlayhead', undefined);
                    return false;
                case 'Home':
                    seekPlayhead(0);
                    return true;
                case 'End':
                    seekPlayhead(getLastClipEndBeat());
                    return true;
                case ']':
                    goToNextMarker();
                    return false;
                case '[':
                    goToPreviousMarker();
                    return false;
                default: {
                    const numberTool = NUMBER_TOOL_MAP[key];
                    if (numberTool) {
                        setEditingTool(numberTool);
                        return false;
                    }
                    const tool = TOOL_SHORTCUTS[key];
                    if (tool) {
                        setEditingTool(tool);
                    }
                    return false;
                }
            }
        };

        return function handleKeydown(desc: KeyDescriptor): boolean {
            const { key, mod, shift, alt, repeat, isInput } = desc;

            // V: voice toggle (press)
            if (key === 'v' && !mod && !shift && !alt && !repeat) {
                if (isInput) {
                    return false;
                }
                eventBus.emit('voice.toggle', { active: true });
                return true;
            }

            // Check shortcut store first for ALL keys (including those with modifiers)
            const { definitions, customMappings } = shortcutStore.value ?? {
                definitions: [],
                customMappings: {},
            };
            for (const def of definitions) {
                const keys = customMappings[def.id] ?? def.defaultKeys;
                if (matches(desc, keys)) {
                    // Some shortcuts (like Cmd+K) should work even in inputs
                    const allowedInInput = def.id === 'workspace.toggleCommandPalette';
                    if (isInput && !allowedInInput) {
                        continue;
                    }
                    return executeShortcutAction(def.action);
                }
            }

            // All remaining shortcuts are blocked in input fields
            if (isInput) {
                // EXCEPT Cmd+K which is special and handled above if migrated, 
                // but let's keep the legacy fallback for now if not migrated.
                if (key === 'k' && mod) {
                    toggleCommandPalette();
                    return true;
                }
                return false;
            }

            return handleSimpleKeys(key, desc);
        };
    }
);
