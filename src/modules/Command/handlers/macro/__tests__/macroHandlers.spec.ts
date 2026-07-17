import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getMacroHandlers } from '../../../useCases/getMacroHandlers';
import { deleteMacro } from '../../../useCases/macro/management/deleteMacro';
import { renameMacro } from '../../../useCases/macro/management/renameMacro';
import { playMacro } from '../../../useCases/macro/playback';
import { startMacroRecording } from '../../../useCases/macro/recording/startMacroRecording';
import { stopMacroRecording } from '../../../useCases/macro/recording/stopMacroRecording';
import { handleDeleteMacro } from '../handleDeleteMacro';
import { handlePlayMacro } from '../handlePlayMacro';
import { handleRenameMacro } from '../handleRenameMacro';
import { handleStartMacroRecording } from '../handleStartMacroRecording';
import { handleStopMacroRecording } from '../handleStopMacroRecording';

vi.mock('../../../useCases/macro/recording/startMacroRecording', () => ({ startMacroRecording: vi.fn() }));
vi.mock('../../../useCases/macro/recording/stopMacroRecording', () => ({ stopMacroRecording: vi.fn() }));
vi.mock('../../../useCases/macro/playback', () => ({ playMacro: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../useCases/macro/management/deleteMacro', () => ({ deleteMacro: vi.fn() }));
vi.mock('../../../useCases/macro/management/renameMacro', () => ({ renameMacro: vi.fn() }));

describe('Command Macro Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleStartMacroRecording should delegate to startMacroRecording', () => {
        void handleStartMacroRecording.execute({ type: 'startMacroRecording' });
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

    it('handleRenameMacro should delegate to renameMacro', () => {
        void handleRenameMacro.execute({ type: 'renameMacro', payload: { macroId: 'm1', name: 'Renamed' } });
        expect(renameMacro).toHaveBeenCalledWith('m1', 'Renamed');
    });

    it('handleRenameMacro is not undoable and labels "Rename Macro"', () => {
        expect(handleRenameMacro.undoable).toBe(false);
        expect(handleRenameMacro.describe({ type: 'renameMacro', payload: { macroId: 'm1', name: 'x' } })).toEqual({
            label: 'Rename Macro',
        });
    });

    it('getMacroHandlers registers a handler for renameMacro (no dangling action-without-handler)', () => {
        // Regression for the round-1 loose end: a `renameMacro` AppAction existed
        // in the union with no registered handler, so executeAppAction({type:
        // 'renameMacro'}) had no dispatch target. The handler map must now resolve it.
        expect(getMacroHandlers().renameMacro).toBe(handleRenameMacro);
    });
});
