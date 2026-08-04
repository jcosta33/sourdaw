import { describe, it, expect } from 'vitest';

import { findDeniedPromptIntent } from '../findDeniedPromptIntent';

describe('findDeniedPromptIntent — exact phrase matching per action type', () => {
    it('matches saveProject phrases', () => {
        expect(findDeniedPromptIntent('save')).toBe('saveProject');
        expect(findDeniedPromptIntent('save project')).toBe('saveProject');
        expect(findDeniedPromptIntent('ctrl s')).toBe('saveProject');
    });

    it('matches newProject phrases', () => {
        expect(findDeniedPromptIntent('new')).toBe('newProject');
        expect(findDeniedPromptIntent('new project')).toBe('newProject');
        expect(findDeniedPromptIntent('fresh project')).toBe('newProject');
    });

    it('matches exportProject phrases', () => {
        expect(findDeniedPromptIntent('export')).toBe('exportProject');
        expect(findDeniedPromptIntent('bounce')).toBe('exportProject');
        expect(findDeniedPromptIntent('render')).toBe('exportProject');
        expect(findDeniedPromptIntent('mixdown')).toBe('exportProject');
        expect(findDeniedPromptIntent('wav')).toBe('exportProject');
        expect(findDeniedPromptIntent('mp3')).toBe('exportProject');
    });

    it('matches importAudioFile phrases', () => {
        expect(findDeniedPromptIntent('import audio')).toBe('importAudioFile');
        expect(findDeniedPromptIntent('import wav')).toBe('importAudioFile');
        expect(findDeniedPromptIntent('import file')).toBe('importAudioFile');
        expect(findDeniedPromptIntent('open audio')).toBe('importAudioFile');
    });

    it('matches importMidiFile phrases', () => {
        expect(findDeniedPromptIntent('import midi')).toBe('importMidiFile');
        expect(findDeniedPromptIntent('open midi')).toBe('importMidiFile');
    });

    it('matches leaveCollabSession phrases', () => {
        expect(findDeniedPromptIntent('leave session')).toBe('leaveCollabSession');
        expect(findDeniedPromptIntent('stop collaboration')).toBe('leaveCollabSession');
        expect(findDeniedPromptIntent('disconnect')).toBe('leaveCollabSession');
    });
});

describe('findDeniedPromptIntent — non-matching and exactness', () => {
    it('returns null for a non-matching string', () => {
        expect(findDeniedPromptIntent('play notes')).toBeNull();
    });

    it('returns null for an empty string', () => {
        expect(findDeniedPromptIntent('')).toBeNull();
    });

    it('uses exact match (Array.includes), not substring — "exporting" does NOT match "export"', () => {
        expect(findDeniedPromptIntent('exporting')).toBeNull();
    });

    it('uses exact match — "saving" does NOT match "save"', () => {
        expect(findDeniedPromptIntent('saving')).toBeNull();
    });

    it('uses exact match — "bouncing" does NOT match "bounce"', () => {
        expect(findDeniedPromptIntent('bouncing')).toBeNull();
    });
});
