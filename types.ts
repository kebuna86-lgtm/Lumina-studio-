export interface Scene {
  id: string;
  number: number;
  slugline: string;
  description: string;
  storyboardUrl?: string;
  videoUrl?: string;
  duration: number; // in seconds
}

export interface Script {
  title: string;
  rawContent: string;
  scenes: Scene[];
}

export interface TimelineClip {
  id: string;
  trackId: number;
  startTime: number;
  duration: number;
  name: string;
  type: 'video' | 'audio' | 'effect' | 'title';
  color: string;
  sceneId?: string;
}

export interface Track {
  id: number;
  name: string;
  type: 'video' | 'audio';
  clips: TimelineClip[];
}

export type Tab = 'script' | 'storyboard' | 'timeline';

export interface VeoGenerationState {
  isGenerating: boolean;
  progressMessage: string;
}