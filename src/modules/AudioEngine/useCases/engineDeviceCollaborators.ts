import { type EngineDeviceCollaborators } from '../models/EngineDeviceCollaborators';

import { captureDeviceParameterRuntimeWriteReceipt } from './deviceControls/captureDeviceParameterRuntimeWriteReceipt';
import { applyParams } from './deviceResolvers/applyParams';
import { createBuiltinDeviceNode } from './deviceResolvers/createBuiltinDeviceNode';
import { createFaustDeviceNode } from './deviceResolvers/createFaustDeviceNode';
import { clearReportedLatency } from './latencyCompensation/compensation/clearReportedLatency';
import { reportLatency } from './latencyCompensation/compensation/reportLatency';

/** The use cases the live graph builds devices and reports through; `engine/` may not import them itself. */
export const engineDeviceCollaborators: EngineDeviceCollaborators = {
    createBuiltinDeviceNode,
    applyParams,
    captureParameterWriteReceipt: captureDeviceParameterRuntimeWriteReceipt,
    createFaustDeviceNode,
    reportLatency,
    clearReportedLatency,
};
