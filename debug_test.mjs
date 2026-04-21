import fs from 'fs';
let content = fs.readFileSync('src/modules/Automation/useCases/automationRecording/__tests__/stopAutomationRecording.spec.ts', 'utf8');
content = content.replace('stopAutomationRecording();', 'console.log("BEFORE"); stopAutomationRecording(); console.log("AFTER");');
fs.writeFileSync('src/modules/Automation/useCases/automationRecording/__tests__/stopAutomationRecording.spec.ts', content);
