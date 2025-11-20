
export interface Suggestion {
  title: string;
  description: string;
}

export interface ImageState {
  original: string | null; // Base64 string
  mimeType: string;
}

export enum AppStep {
  HOME = 'HOME',
  WORKFLOW_SELECT = 'WORKFLOW_SELECT',
  UPLOAD = 'UPLOAD',
  ANALYZING = 'ANALYZING',
  GENERATING = 'GENERATING',
  RESULTS = 'RESULTS',
  DETAIL_VIEW = 'DETAIL_VIEW',
  MASKING = 'MASKING',
  REPLACE_OPTIONS = 'REPLACE_OPTIONS',
}

export interface GeneratedImage {
  id: string;
  data: string; // Base64
}
