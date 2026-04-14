import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStartMacroRecording } from '../handleStartMacroRecording';
import { handleStopMacroRecording } from '../handleStopMacroRecording';
import { handlePlayMacro } from '../handlePlayMacro';
import { handleDeleteMacro } from '../handleDeleteMacro';

import { startMacroRecording } from '../../../useCases/macro/recording/startMacroRecording';
import { stopMacroRecording } from '../../../useCases/macro/recording/stopMacroRecording';
import { playMacro } from '../../../useCases/macro/playback';
import { deleteMacro } from '../../../useCases/macro/management/deleteMacro';

vi.mock('../../../useCases/macro/recording/startMacroRecording', () => ({ startMacroRecording: vi.fn() }));
vi.mock('../../../useCases/macro/recording/stopMacroRecording', () => ({ stopMacroRecording: vi.fn() }));
vi.mock('../../../useCases/macro/playback', () => ({ playMacro: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../useCases/macro/management/deleteMacro', () => ({ deleteMacro: vi.fn() }));

describe('Command Macro Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleStartMacroRecording should delegate to startMacroRecording', () => {
        handleStartMacroRecording.execute({ type: 'startMacroRecording', payload: {} });
        expect(startMacroRecording).toHaveBeenCalled();
    });

    it('handleStopMacroRecording should delegate to stopMacroRecording', () => {
        handleStopMacroRecording.execute({ type: 'stopMacroRecording', payload: { name: 'My Macro' } });
        expect(stopMacroRecording).toHaveBeenCalledWith('My Macro');
    });

    it('handlePlayMacro should delegate to playMacro', async () => {
        await handlePlayMacro.execute({ type: 'playMacro', payload: { macroId: 'm1' } });
        expect(playMacro).toHaveBeenCalledWith('m1');
    });

    it('handleDeleteMacro should delegate to deleteMacro', () => {
        handleDeleteMacro.execute({ type: 'deleteMacro', payload: { macroId: 'm1' } });
        expect(deleteMacro).toHaveBeenCalledWith('m1');
    });
});
