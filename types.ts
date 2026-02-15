export interface SentimentPoint {
  date: string;
  sentiment: number; // -1 to 1
}

export interface Keyword {
  text: string;
  count: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface AnalysisResult {
  trend: SentimentPoint[];
  keywords: Keyword[];
  summary: {
    title: string;
    points: string[];
    actionableAreas: {
      area: string;
      description: string;
    }[];
  };
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  CHAT = 'CHAT',
  VOICE = 'VOICE',
  VIDEO = 'VIDEO',
  PROJECTS = 'PROJECTS',
}

// Voice Agent Types
export interface VoiceTranscriptItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  isFinal: boolean;
}

export interface VoiceSession {
  id: string;
  startTime: string;
  title: string; // e.g., "Conversation on Oct 12, 10:00 AM"
  transcripts: VoiceTranscriptItem[];
}

// Project Management Types
export type SavedItemType = 'ANALYSIS' | 'CHAT' | 'VIDEO' | 'VOICE_SESSION';

export interface SavedItem {
  id: string;
  type: SavedItemType;
  title: string;
  date: string;
  data: any; // Flexible payload depending on type
  tags: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  items: SavedItem[];
}