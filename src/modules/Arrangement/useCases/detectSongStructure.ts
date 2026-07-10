/**
 * Detect song structure from clip arrangement.
 *
 * Analyzes the layout of clips across tracks to identify structural sections.
 * Uses clip density, position clustering, and gap analysis.
 */

import { trackStore } from '../stores/trackStore';

import { SECTION_PALETTE, type DetectedSection } from './songStructureDetection';

type ClipInfo = { startBeat: number; endBeat: number; trackId: string };

export function detectSongStructure(trackId?: string): DetectedSection[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    // Gather all clips from target track or all tracks
    const targetTracks = trackId
        ? state.tracks.filter((time) => time.id === trackId)
        : state.tracks.filter((time) => time.kind === 'audio' || time.kind === 'midi');

    const allClips: ClipInfo[] = [];

    for (const track of targetTracks) {
        for (const clip of track.clips) {
            allClips.push({
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                trackId: track.id,
            });
        }
    }

    if (allClips.length === 0) {
        return [];
    }

    // Find the full range
    let minBeat = Infinity;
    let maxBeat = -Infinity;
    for (const context of allClips) {
        if (context.startBeat < minBeat) {
            minBeat = context.startBeat;
        }
        if (context.endBeat > maxBeat) {
            maxBeat = context.endBeat;
        }
    }
    const totalBeats = maxBeat - minBeat;

    if (totalBeats <= 0) {
        return [];
    }

    // Step 1: Compute energy profile (clip density per beat window)
    const windowSize = 4; // 1 bar in 4/4
    const numWindows = Math.ceil(totalBeats / windowSize);
    const energy: number[] = Array.from({ length: numWindows }, () => 0);

    for (const clip of allClips) {
        const startWindow = Math.floor((clip.startBeat - minBeat) / windowSize);
        const endWindow = Math.min(Math.ceil((clip.endBeat - minBeat) / windowSize), numWindows);
        for (let w = startWindow; w < endWindow; w++) {
            energy[w]!++;
        }
    }

    // Step 2: Detect boundaries via energy changes
    const boundaries: number[] = [0]; // always start at 0
    const threshold = 0.3;

    for (let index = 1; index < numWindows; index++) {
        const prev = energy[index - 1]!;
        const curr = energy[index]!;
        const maxE = Math.max(prev, curr, 1);
        const change = Math.abs(curr - prev) / maxE;

        if (change >= threshold) {
            boundaries.push(index);
        }
    }

    // Ensure segments are at least 4 bars (16 beats) apart
    const mergedBoundaries: number[] = [boundaries[0]!];
    for (let index = 1; index < boundaries.length; index++) {
        const last = mergedBoundaries[mergedBoundaries.length - 1]!;
        if (boundaries[index]! - last >= 4) {
            // 4 windows = 4 bars = 16 beats
            mergedBoundaries.push(boundaries[index]!);
        }
    }

    // Step 3: Classify each segment using energy profile
    const sections: DetectedSection[] = [];
    const avgEnergy = energy.reduce((alpha, buffer) => alpha + buffer, 0) / energy.length;

    for (let index = 0; index < mergedBoundaries.length; index++) {
        const startWindow = mergedBoundaries[index]!;
        const endWindow = index + 1 < mergedBoundaries.length ? mergedBoundaries[index + 1]! : numWindows;
        const startBeat = minBeat + startWindow * windowSize;
        const endBeat = minBeat + endWindow * windowSize;

        // Compute segment energy
        let segEnergy = 0;
        for (let w = startWindow; w < endWindow; w++) {
            segEnergy += energy[w]!;
        }
        segEnergy /= endWindow - startWindow || 1;

        // Classify segment based on position and energy
        const progress = startWindow / numWindows;
        const isHigh = segEnergy > avgEnergy * 1.2;
        const isLow = segEnergy < avgEnergy * 0.5;

        let sectionInfo: { name: string; color: string } = SECTION_PALETTE[1]; // default: Verse
        let confidence = 0.6;

        if (progress < 0.1 && index === 0) {
            sectionInfo = SECTION_PALETTE[0]!; // Intro
            confidence = 0.85;
        } else if (progress > 0.85 && index === mergedBoundaries.length - 1) {
            sectionInfo = SECTION_PALETTE[5]!; // Outro
            confidence = 0.8;
        } else if (isHigh && progress > 0.5) {
            sectionInfo = SECTION_PALETTE[7]!; // Drop
            confidence = 0.6;
        } else if (isHigh) {
            sectionInfo = SECTION_PALETTE[3]!; // Chorus
            confidence = 0.7;
        } else if (isLow) {
            sectionInfo = SECTION_PALETTE[6]!; // Break
            confidence = 0.65;
        } else {
            // Check if this leads into a high energy section → Pre-Chorus
            if (index + 1 < mergedBoundaries.length) {
                const nextStart = mergedBoundaries[index + 1]!;
                const nextEnd = index + 2 < mergedBoundaries.length ? mergedBoundaries[index + 2]! : numWindows;
                let nextEnergy = 0;
                for (let w = nextStart; w < nextEnd; w++) {
                    nextEnergy += energy[w]!;
                }
                nextEnergy /= nextEnd - nextStart || 1;
                if (nextEnergy > avgEnergy * 1.3) {
                    sectionInfo = SECTION_PALETTE[2]!; // Pre-Chorus
                    confidence = 0.55;
                }
            }
        }

        // Avoid consecutive same-named sections by alternating Verse/Bridge
        if (sections.length > 0 && sections[sections.length - 1]!.name === sectionInfo.name) {
            if (sectionInfo.name === 'Verse') {
                sectionInfo = SECTION_PALETTE[4]!; // Bridge
            } else if (sectionInfo.name === 'Chorus') {
                sectionInfo = SECTION_PALETTE[1]!; // Verse
            }
        }

        sections.push({
            startBeat,
            endBeat: Math.min(endBeat, maxBeat),
            name: sectionInfo.name,
            color: sectionInfo.color,
            confidence,
        });
    }

    return sections;
}
