import fs from 'fs';
let content = fs.readFileSync('src/modules/Automation/useCases/automationRecording/__tests__/stopAutomationRecording.spec.ts', 'utf8');
content = content.replace(
    /vi\.mock\('#\/modules\/Arrangement\/useCases', async \(importOriginal\) => \{[\s\S]*?\}\);/,
    "vi.mock('#/modules/Arrangement/useCases', () => ({ getAllTracks: vi.fn() }));"
);
fs.writeFileSync('src/modules/Automation/useCases/automationRecording/__tests__/stopAutomationRecording.spec.ts', content);
