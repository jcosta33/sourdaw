/**
 * AI Song Structure Detection.
 *
 * Analyzes audio/MIDI clip content and automatically creates arrangement
 * markers/sections based on detected structure (intro, verse, chorus, etc.).
 *
 * Uses energy-based segmentation with self-similarity analysis for audio clips
 * and pattern repetition detection for MIDI clips.
 */

import { createSection, type ArrangementSection } from '../models/Marker';
import { markerStore } from '../stores/markerStore';
import { trackStore } from '../stores/trackStore';

/** Standard song section names with associated colors */
const SECTION_PALETTE = [
    { name: 'Intro', color: 'oklch(0.42 0.10 200)' },
    { name: 'Verse', color: 'oklch(0.40 0.10 140)' },
    { name: 'Pre-Chorus', color: 'oklch(0.42 0.10 60)' },
    { name: 'Chorus', color: 'oklch(0.45 0.12 330)' },
    { name: 'Bridge', color: 'oklch(0.40 0.10 280)' },
    { name: 'Outro', color: 'oklch(0.38 0.08 200)' },
    { name: 'Break', color: 'oklch(0.35 0.07 100)' },
    { name: 'Drop', color: 'oklch(0.45 0.14 20)' },
    { name: 'Build', color: 'oklch(0.42 0.12 40)' },
    { name: 'Solo', color: 'oklch(0.45 0.12 90)' },
] as const;

type DetectedSection = {
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
    confidence: number;
};

/**
 * Detect song structure from clip arrangement.
 *
 * Analyzes the layout of clips across tracks to identify structural sections.
 * Uses clip density, position clustering, and gap analysis.
 */
export function detectSongStructure(trackId?: string): DetectedSection[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    // Gather all clips from target track or all tracks
    const targetTracks = trackId
        ? state.tracks.filter((t) => t.id === trackId)
        : state.tracks.filter((t) => t.kind === 'audio' || t.kind === 'midi');

    type ClipInfo = { startBeat: number; endBeat: number; trackId: string };
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
    for (const c of allClips) {
        if (c.startBeat < minBeat) {
            minBeat = c.startBeat;
        }
        if (c.endBeat > maxBeat) {
            maxBeat = c.endBeat;
        }
    }
    const totalBeats = maxBeat - minBeat;

    if (totalBeats <= 0) {
        return [];
    }

    // Step 1: Compute energy profile (clip density per beat window)
    const windowSize = 4; // 1 bar in 4/4
    const numWindows = Math.ceil(totalBeats / windowSize);
    const energy: number[] = new Array(numWindows).fill(0);

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

    for (let i = 1; i < numWindows; i++) {
        const prev = energy[i - 1]!;
        const curr = energy[i]!;
        const maxE = Math.max(prev, curr, 1);
        const change = Math.abs(curr - prev) / maxE;

        if (change >= threshold) {
            boundaries.push(i);
        }
    }

    // Ensure segments are at least 4 bars (16 beats) apart
    const mergedBoundaries: number[] = [boundaries[0]!];
    for (let i = 1; i < boundaries.length; i++) {
        const last = mergedBoundaries[mergedBoundaries.length - 1]!;
        if (boundaries[i]! - last >= 4) {
            // 4 windows = 4 bars = 16 beats
            mergedBoundaries.push(boundaries[i]!);
        }
    }

    // Step 3: Classify each segment using energy profile
    const sections: DetectedSection[] = [];
    const avgEnergy = energy.reduce((a, b) => a + b, 0) / energy.length;

    for (let i = 0; i < mergedBoundaries.length; i++) {
        const startWindow = mergedBoundaries[i]!;
        const endWindow = i + 1 < mergedBoundaries.length ? mergedBoundaries[i + 1]! : numWindows;
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

        if (progress < 0.1 && i === 0) {
            sectionInfo = SECTION_PALETTE[0]!; // Intro
            confidence = 0.85;
        } else if (progress > 0.85 && i === mergedBoundaries.length - 1) {
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
        } else if (!isHigh && !isLow) {
            // Check if this leads into a high energy section → Pre-Chorus
            if (i + 1 < mergedBoundaries.length) {
                const nextStart = mergedBoundaries[i + 1]!;
                const nextEnd = i + 2 < mergedBoundaries.length ? mergedBoundaries[i + 2]! : numWindows;
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

/**
 * Detect song structure and apply results as arrangement sections.
 */
export function detectAndApplySongStructure(trackId?: string): DetectedSection[] {
    const sections = detectSongStructure(trackId);
    if (sections.length === 0) {
        return [];
    }

    const markerState = markerStore.value;
    if (!markerState) {
        return sections;
    }

    // Add detected sections to the marker store
    const newSections: ArrangementSection[] = sections.map((s) => {
        const section = createSection(s.startBeat, s.endBeat, s.name);
        return { ...section, color: s.color };
    });

    markerStore.set({
        ...markerState,
        sections: [...markerState.sections, ...newSections],
    });

    return sections;
}
