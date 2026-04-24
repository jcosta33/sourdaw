import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTrackById } from '#/modules/Arrangement/useCases';
import { isRecordingAutomation } from './src/modules/Automation/useCases/automationRecording/isRecordingAutomation';

console.log("getTrackById is:", getTrackById);
