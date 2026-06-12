/**
 * Scene schema matching the Dental Formula / Edubee template architecture.
 *
 * SEGMENTS are the fixed timing windows from the "Pro" template comp.
 * Every scene type maps to one of these segments, which determines
 * the duration and time-range used when duplicating the template.
 */

// ── Template segment timings (from the "Pro" comp) ─────────────────
export const SEGMENTS = {
  title:   { start: 0.00,  duration: 6.36,  playDuration: 6.36  },
  outro:   { start: 0.00,  duration: 2.44,  playDuration: 2.44  },
  pair:    { start: 6.36,  duration: 11.92, playDuration: 8.60  },
  center:  { start: 18.28, duration: 7.44,  playDuration: 7.48  },
  single:  { start: 25.76, duration: 7.48,  playDuration: 7.20  },
  triple:  { start: 33.24, duration: 25.16, playDuration: 12.60 },
} as const;

export type SegmentKey = keyof typeof SEGMENTS;

// ── Layout constants (pixel positions from the template) ───────────
export const LAYOUT = {
  SINGLE_CANVAS:  { width: 1264, height: 844 },
  TRIPLE_CANVAS:  { width: 1408, height: 768 },
  PAIR_LARGE:     { width: 1408, height: 768 },
  PAIR_SMALL:     { width: 625,  height: 350 },

  PAIR_CLIPBOARD_POSITION:  [1353.969, 493.992, 0],
  PAIR_CLIPBOARD_SCALE:     [119, 119, 100],
  BOARD_TEACHER_POSITION:   [352, 722, 0],
  BOARD_TEACHER_SCALE:      [105, 105, 100],

  SINGLE_HEADER_POSITION:   [486.676, 191.922, 0],
  TODAY_HEADER_POSITION:    [486.676, 162, 0],
  TRIPLE_HEADER_POSITION:   [1274.516, 273.75, 0],
  TRIPLE_HEADER_NEAR_CLIP:  [1274.516, 246, 0],

  SUBTITLE_BAR_HEIGHT: 54,
  SUBTITLE_BAR_OPACITY: 58,
  SUBTITLE_FONT: "ArialMT",
  SUBTITLE_FONT_SIZE: 22,
  SUBTITLE_SIDE_PADDING: 38,

  BOARD_HEADER_FONT_SIZE: 50,
} as const;

// ── Subtitle block ────────────────────────────────────────────────
export interface SubtitleBlock {
  /** Start time relative to scene start (seconds) */
  start: number;
  /** End time relative to scene start (seconds) */
  end: number;
  /** Subtitle text */
  text: string;
}

// ── Timed body text step ──────────────────────────────────────────
export interface BodyStep {
  /** Start time relative to scene start (seconds) */
  start: number;
  /** End time relative to scene start (seconds) */
  end: number;
  /** Body text to display */
  text: string;
}

// ── Scene type ────────────────────────────────────────────────────
export const SCENE_TYPES = [
  "title",
  "center",
  "pair",
  "single",
  "triple",
  "summary",
  "outro",
] as const;

export type SceneType = typeof SCENE_TYPES[number];

// ── Teacher config ────────────────────────────────────────────────
export interface Teacher {
  name: string;
  role: string;
}

// ── AE config ─────────────────────────────────────────────────────
export interface AEConfig {
  master_comp_name: string;
  scene_comp_prefix: string;
  width: number;
  height: number;
  fps: number;
}

// ── Asset plans ───────────────────────────────────────────────────
export interface FixedAssetPlan {
  logo: string;
  piced_logo: string;
  clipboard: string;
  audio_jingle: string;
  background: string;
  background_alt?: string;
  intro_video: string;
  presenter_video: string;
  template_aep: string;
}

export interface AssetPlan {
  teacher_video: string;
  teacher_video_background?: "green_screen" | "white_or_light";
  voiceover: string | null;
  images: string[];
  fixed: FixedAssetPlan;
}

// ── Scene ─────────────────────────────────────────────────────────
export interface Scene {
  id: string;
  type: SceneType;
  duration: number;
  title: string;
  header?: string;
  body: string;
  narration: string;
  visual_cues: string;
  image_files: string[];
  on_screen_text: string;
  layout_note: string;

  /** Timed subtitle blocks for this scene */
  subtitles?: SubtitleBlock[];

  /** Timed body text steps (used for triple/summary scenes where text swaps) */
  body_steps?: BodyStep[];

  /** Label for left item in pair scenes */
  left_label?: string;
  /** Label for right item in pair scenes */
  right_label?: string;

  /** Lower-third teacher nameplate text */
  lower_third_main?: string;
  /** Lower-third teacher subtitle text */
  lower_third_sub?: string;
}

// ── Lesson manifest ───────────────────────────────────────────────
export interface LessonManifest {
  project_name: string;
  subject: string;
  chapter: string;
  topic: string;
  video_title: string;
  learning_objective: string;
  teacher: Teacher;
  ae: AEConfig;
  asset_plan: AssetPlan;
  scenes: Scene[];
}

// ── Form metadata ─────────────────────────────────────────────────
export interface FormMeta {
  subject: string;
  chapter: string;
  topic: string;
  video_title: string;
  learning_objective: string;
  teacher_name: string;
  teacher_role: string;
}
