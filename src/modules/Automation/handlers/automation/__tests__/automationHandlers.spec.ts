import { describe, it, expect, vi, beforeEach } from 'vitest';

import { quantizeAutomationBeats } from '../../../useCases/automation/quantizeAutomationBeats';
import { reverseAutomation } from '../../../useCases/automation/reverseAutomation';
import { scaleAutomationValues } from '../../../useCases/automation/scaleAutomationValues';
import { stretchAutomationTime } from '../../../useCases/automation/stretchAutomationTime';
import { thinAutomationPoints } from '../../../useCases/automation/thinAutomationPoints';
import { handleQuantizeAutomation } from '../handleQuantizeAutomation';
import { handleReverseAutomation } from '../handleReverseAutomation';
import { handleScaleAutomation } from '../handleScaleAutomation';
import { handleStretchAutomation } from '../handleStretchAutomation';
import { handleThinAutomation } from '../handleThinAutomation';

vi.mock('../../../useCases/automation/quantizeAutomationBeats', () => ({ quantizeAutomationBeats: vi.fn() }));
vi.mock('../../../useCases/automation/reverseAutomation', () => ({ reverseAutomation: vi.fn() }));
vi.mock('../../../useCases/automation/scaleAutomationValues', () => ({ scaleAutomationValues: vi.fn() }));
vi.mock('../../../useCases/automation/stretchAutomationTime', () => ({ stretchAutomationTime: vi.fn() }));
vi.mock('../../../useCases/automation/thinAutomationPoints', () => ({ thinAutomationPoints: vi.fn() }));

describe('Automation Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleQuantizeAutomation should delegate to quantizeAutomationBeats', () => {
        void handleQuantizeAutomation.execute({
            type: 'quantizeAutomation',
            payload: { laneId: 'l1', gridSize: 0.25 },
        });
        expect(quantizeAutomationBeats).toHaveBeenCalledWith('l1', 0.25);
    });

    it('handleReverseAutomation should delegate to reverseAutomation', () => {
        void handleReverseAutomation.execute({
            type: 'reverseAutomation',
            payload: { laneId: 'l1' },
        });
        expect(reverseAutomation).toHaveBeenCalledWith('l1');
    });

    it('handleScaleAutomation should delegate to scaleAutomationValues', () => {
        void handleScaleAutomation.execute({
            type: 'scaleAutomation',
            payload: { laneId: 'l1', factor: 2, anchor: 0.5 },
        });
        expect(scaleAutomationValues).toHaveBeenCalledWith('l1', 2, 0.5);
    });

    it('handleStretchAutomation should delegate to stretchAutomationTime', () => {
        void handleStretchAutomation.execute({
            type: 'stretchAutomation',
            payload: { laneId: 'l1', factor: 1.5, anchorBeat: 10 },
        });
        expect(stretchAutomationTime).toHaveBeenCalledWith('l1', 1.5, 10);
    });

    it('handleThinAutomation should delegate to thinAutomationPoints', () => {
        void handleThinAutomation.execute({
            type: 'thinAutomation',
            payload: { laneId: 'l1', tolerance: 0.05 },
        });
        expect(thinAutomationPoints).toHaveBeenCalledWith('l1', 0.05);
    });
});
