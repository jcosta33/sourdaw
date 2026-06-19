import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deleteMacro } from '../../../useCases/macro/management/deleteMacro';
import { playMacro } from '../../../useCases/macro/playback';
import { startMacroRecording } from '../../../useCases/macro/recording/startMacroRecording';
import { stopMacroRecording } from '../../../useCases/macro/recording/stopMacroRecording';
import { handleDeleteMacro } from '../handleDeleteMacro';
import { handlePlayMacro } from '../handlePlayMacro';
import { handleStartMacroRecording } from '../handleStartMacroRecording';
import { handleStopMacroRecording } from '../handleStopMacroRecording';

vi.mock('../../../useCases/macro/recording/startMacroRecording', () => ({ startMacroRecording: vi.fn() }));
vi.mock('../../../useCases/macro/recording/stopMacroRecording', () => ({ stopMacroRecording: vi.fn() }));
vi.mock('../../../useCases/macro/playback', () => ({ playMacro: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../useCases/macro/management/deleteMacro', () => ({ deleteMacro: vi.fn() }));

describe('Command Macro Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleStartMacroRecording should delegate to startMacroRecording', () => {
        void handleStartMacroRecording.execute({ type: 'startMacroRecording', payload: {} });
        expect(startMacroRecording).toHaveBeenCalled();
    });

    it('handleStopMacroRecording should delegate to stopMacroRecording', () => {
        void handleStopMacroRecording.execute({ type: 'stopMacroRecording', payload: { name: 'My Macro' } });
        expect(stopMacroRecording).toHaveBeenCalledWith('My Macro');
    });

    it('handlePlayMacro should delegate to playMacro', async () => {
        await handlePlayMacro.execute({ type: 'playMacro', payload: { macroId: 'm1' } });
        expect(playMacro).toHaveBeenCalledWith('m1');
    });

    it('handleDeleteMacro should delegate to deleteMacro', () => {
        void handleDeleteMacro.execute({ type: 'deleteMacro', payload: { macroId: 'm1' } });
        expect(deleteMacro).toHaveBeenCalledWith('m1');
    });

    it('handleDeleteMacro is not undoable (no inverse exists, so Cmd+Z must not consume the press)', () => {
        // Regression for audit #4: marking deleteMacro undoable with no inverseAction made
        // Cmd+Z a silent no-op that still consumed the keypress. Until a restore action
        // exists, the action stays out of the undo history.
        expect(handleDeleteMacro.undoable).toBe(false);
        expect(handleDeleteMacro.describe({ type: 'deleteMacro', payload: { macroId: 'm1' } })).toEqual({
            label: 'Delete Macro',
        });
    });
});
