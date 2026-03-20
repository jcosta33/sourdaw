/**
 * Video Track use cases.
 * Manages a reference video file synced to the timeline
 * for film scoring and video editing workflows.
 */

export type VideoTrack = {
    id: string;
    name: string;
    filePath: string;
    durationSeconds: number;
    offsetBeats: number;
    frameRate: number;
    width: number;
    height: number;
    visible: boolean;
    muted: boolean;
};

export type VideoTimecode = {
    hours: number;
    minutes: number;
    seconds: number;
    frames: number;
};

let activeVideoTrack: VideoTrack | null = null;
let videoElement: HTMLVideoElement | null = null;

/**
 * Import a video file and create a video track.
 */
export async function importVideo(file: File): Promise<VideoTrack> {
    const url = URL.createObjectURL(file);

    // Get video metadata
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.src = url;

    const metadata = await new Promise<{ duration: number; width: number; height: number }>((resolve) => {
        tempVideo.onloadedmetadata = () => {
            resolve({
                duration: tempVideo.duration,
                width: tempVideo.videoWidth,
                height: tempVideo.videoHeight,
            });
        };
    });

    const track: VideoTrack = {
        id: `video-${crypto.randomUUID().slice(0, 8)}`,
        name: file.name,
        filePath: url,
        durationSeconds: metadata.duration,
        offsetBeats: 0,
        frameRate: 30, // Default, can be detected
        width: metadata.width,
        height: metadata.height,
        visible: true,
        muted: true, // Default muted — audio comes from audio tracks
    };

    activeVideoTrack = track;
    tempVideo.remove();

    return track;
}

/**
 * Create or get the video playback element.
 */
export function getVideoElement(): HTMLVideoElement | null {
    if (videoElement) {
        return videoElement;
    }
    if (!activeVideoTrack) {
        return null;
    }

    videoElement = document.createElement('video');
    videoElement.src = activeVideoTrack.filePath;
    videoElement.muted = activeVideoTrack.muted;
    videoElement.playsInline = true;
    videoElement.preload = 'auto';
    videoElement.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';

    return videoElement;
}

/**
 * Sync video playback to DAW transport.
 */
export function syncVideoToTransport(
    playheadBeats: number,
    tempo: number,
    isPlaying: boolean
): void {
    if (!videoElement || !activeVideoTrack) {
        return;
    }

    const offsetSeconds = (playheadBeats - activeVideoTrack.offsetBeats) * (60 / tempo);
    const targetTime = Math.max(0, Math.min(offsetSeconds, activeVideoTrack.durationSeconds));

    if (isPlaying) {
        // Sync position if drifted more than 1 frame
        const frameDuration = 1 / activeVideoTrack.frameRate;
        if (Math.abs(videoElement.currentTime - targetTime) > frameDuration) {
            videoElement.currentTime = targetTime;
        }
        if (videoElement.paused) {
            void videoElement.play();
        }
    } else {
        videoElement.pause();
        videoElement.currentTime = targetTime;
    }
}

/**
 * Convert beats to SMPTE timecode.
 */
export function beatsToTimecode(beats: number, tempo: number, fps = 30): VideoTimecode {
    const totalSeconds = beats * (60 / tempo);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const frames = Math.floor((totalSeconds % 1) * fps);

    return { hours, minutes, seconds, frames };
}

/**
 * Format timecode as HH:MM:SS:FF.
 */
export function formatTimecode(tc: VideoTimecode): string {
    return [
        String(tc.hours).padStart(2, '0'),
        String(tc.minutes).padStart(2, '0'),
        String(tc.seconds).padStart(2, '0'),
        String(tc.frames).padStart(2, '0'),
    ].join(':');
}

/**
 * Set the video track offset in beats.
 */
export function setVideoOffset(offsetBeats: number): void {
    if (activeVideoTrack) {
        activeVideoTrack.offsetBeats = offsetBeats;
    }
}

/**
 * Toggle video track visibility.
 */
export function toggleVideoVisibility(): void {
    if (activeVideoTrack) {
        activeVideoTrack.visible = !activeVideoTrack.visible;
    }
}

/**
 * Remove video track.
 */
export function removeVideoTrack(): void {
    if (videoElement) {
        videoElement.pause();
        videoElement.remove();
        videoElement = null;
    }
    if (activeVideoTrack) {
        URL.revokeObjectURL(activeVideoTrack.filePath);
        activeVideoTrack = null;
    }
}

/**
 * Get the active video track.
 */
export function getActiveVideoTrack(): VideoTrack | null {
    return activeVideoTrack;
}
