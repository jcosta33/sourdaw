const fs = require('fs');

function fixImports(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');

    // For factoryPresets.ts, let's just strip the comments between imports manually via replace in the script
    if (filePath.includes('factoryPresets.ts')) {
        content = content.replace(
            /\/\/ ── Category sub-modules ───────────────────────────────────────────────────\n/g,
            ''
        );
        content = content.replace(
            /\/\/ ── Standalone data files \(unchanged — each already < 300 lines\) ──────────\n/g,
            ''
        );
        content = content.replace(
            /\/\/ ── Drum Kit presets ────────────────────────────────────────────────────────\n\/\/ Small enough to stay inline here \(< 60 lines\)\.\n/g,
            ''
        );
        fs.writeFileSync(filePath, content);
        return;
    }

    const lines = content.split('\n');
    const importLines = [];
    const otherLines = [];

    let inImport = false;
    let importBuffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('import ') && !line.includes('} from') && !line.includes('";') && !line.includes("';")) {
            inImport = true;
            importBuffer.push(line);
        } else if (inImport) {
            importBuffer.push(line);
            if (line.includes('} from') || line.includes('";') || line.includes("';")) {
                inImport = false;
                importLines.push(importBuffer.join('\n'));
                importBuffer = [];
            }
        } else if (line.startsWith('import ')) {
            importLines.push(line);
        } else {
            // Drop empty lines that are at the top before any code
            if (line.trim() === '' && otherLines.length === 0) {
                continue;
            }
            otherLines.push(line);
        }
    }

    const newContent = importLines.join('\n') + '\n\n' + otherLines.join('\n');
    fs.writeFileSync(filePath, newContent);
}

const files = [
    'src/modules/AiRuntime/handlers/aiOrganization/__tests__/handleAutoOrganizeProject.spec.ts',
    'src/modules/Arrangement/models/DeviceParameter.ts',
    'src/modules/Arrangement/repositories/presets/factoryPresets.ts',
    'src/modules/AudioAnalysis/handlers/analysis/__tests__/handleAnalyzeMix.spec.ts',
    'src/modules/AudioAnalysis/useCases/referenceMixComparison/__tests__/compareMixes.spec.ts',
    'src/modules/AudioEngine/handlers/finalFeature/__tests__/handleToggleNodeView.spec.ts',
    'src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts',
    'src/modules/AudioEngine/repositories/webMidi/lifecycle/__tests__/getAvailableMidiInputs.spec.ts',
    'src/modules/Automation/handlers/automation/__tests__/handleInvertAutomation.spec.ts',
    'src/modules/Automation/useCases/automationRecording/__tests__/isRecordingAutomation.spec.ts',
    'src/modules/Automation/useCases/automationRecording/__tests__/recordAutomationValue.spec.ts',
    'src/modules/Automation/useCases/automationRecording/__tests__/startAutomationRecording.spec.ts',
    'src/modules/Automation/useCases/automationRecording/__tests__/stopAutomationRecording.spec.ts',
    'src/modules/Collaboration/handlers/collaboration/__tests__/handleCreateCollabSession.spec.ts',
    'src/modules/Command/models/CommandRegistry.ts',
    'src/modules/MIDI/handlers/chordTrack/__tests__/handleRemoveChordEvent.spec.ts',
    'src/modules/MIDI/handlers/patternInstance/__tests__/handleDetachPatternInstance.spec.ts',
    'src/modules/Plugin/handlers/pluginHost/__tests__/handleScanPlugins.spec.ts',
    'src/modules/Project/handlers/songStructure/__tests__/handleDetectSongStructure.spec.ts',
    'src/modules/Project/handlers/versionControl/__tests__/handleCreateProjectVersion.spec.ts',
    'src/modules/Project/useCases/projectPersistence/helpers/__tests__/hydrateModuleStoresFromProjectData.spec.ts',
    'src/modules/Toaster/useCases/__tests__/loadToasterKit.spec.ts',
    'src/modules/Transport/handlers/transport/__tests__/handleSetTempo.spec.ts',
    'src/modules/Workspace/handlers/workspace/__tests__/handleSetWorkspaceMode.spec.ts',
    'src/modules/Workspace/useCases/togglePanel/panelToggles/__tests__/dualView.spec.ts',
];

files.forEach(fixImports);
