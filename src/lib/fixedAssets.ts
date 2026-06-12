/**
 * Fixed / template assets that are used in every video generation.
 * These come from the repo root and are mapped per subject.
 *
 * The GitHub raw URLs are used for preview/reference only.
 * In the ZIP package, these are placed under fixed_assets/ and the
 * generated JSX references them from that folder.
 *
 * NOTE: Logo_08301.tif is excluded — TIF files cause "bad header"
 *       errors in AE's ImportOptions. We use Logo_Transparent.png
 *       for both the overlay and the hi-res logo on title/outro.
 *
 * The Dental Formula .aep template is placed under template/ in the ZIP.
 */

const GITHUB_RAW =
  "https://raw.githubusercontent.com/test17211430/video-gen/main";

// ── Common assets (used in ALL subjects) ──────────────────────────
export interface CommonAssets {
  logo_transparent: FixedFile;
  piced_logo: FixedFile;
  clipboard: FixedFile;
  audio_jingle: FixedFile;
  default_bg: FixedFile;
  presenter_video: FixedFile;
  template_aep: FixedFile;
}

export interface FixedFile {
  /** Original filename in the repo */
  filename: string;
  /** Download URL from GitHub (percent-encoded for spaces) */
  url: string;
  /** Role description for Groq / the AE JSX */
  role: string;
  /** If true, this file goes to template/ instead of fixed_assets/ */
  isTemplate?: boolean;
}

export const COMMON_ASSETS: CommonAssets = {
  logo_transparent: {
    filename: "Logo_Transparent.png",
    url: `${GITHUB_RAW}/Logo_Transparent.png`,
    role: "Logo overlay (transparent PNG) — top-right corner of every scene + title/outro",
  },
  piced_logo: {
    filename: "pic-ed-logo.png",
    url: `${GITHUB_RAW}/pic-ed-logo.png`,
    role: "PicEd branding logo — watermark or lower-third",
  },
  clipboard: {
    filename: "Clipboard.png",
    url: `${GITHUB_RAW}/Clipboard.png`,
    role: "Clipboard graphic overlay — used on text-heavy board scenes",
  },
  audio_jingle: {
    filename: "piced audio.mp3",
    url: `${GITHUB_RAW}/piced%20audio.mp3`,
    role: "Audio jingle — plays during intro and outro scenes",
  },
  default_bg: {
    filename: "BG Blurred.jpg",
    url: `${GITHUB_RAW}/BG%20Blurred.jpg`,
    role: "Default blurred background — fallback for any subject",
  },
  presenter_video: {
    filename: "Bruce Wang.mov",
    url: `${GITHUB_RAW}/Bruce%20Wang.mov`,
    role: "Default presenter/teacher green-screen video",
  },
  template_aep: {
    filename: "Dental Formula (converted).aep",
    url: `${GITHUB_RAW}/Dental%20Formula%20(converted).aep`,
    role: "Dental Formula template project — contains the 'Pro' comp with all animations",
    isTemplate: true,
  },
};

// ── Per-subject assets ────────────────────────────────────────────
export interface SubjectAssets {
  background: FixedFile;
  background_alt?: FixedFile;
  intro_video: FixedFile;
}

export const SUBJECT_ASSETS: Record<string, SubjectAssets> = {
  biology: {
    background: {
      filename: "BG Blurred.jpg",
      url: `${GITHUB_RAW}/BG%20Blurred.jpg`,
      role: "Biology background (blurred)",
    },
    intro_video: {
      filename: "BIOLOGY THEAM.mp4",
      url: `${GITHUB_RAW}/BIOLOGY%20THEAM.mp4`,
      role: "Biology subject intro/theme video — plays before scene 1",
    },
  },
  chemistry: {
    background: {
      filename: "Final Chemistry BG.png",
      url: `${GITHUB_RAW}/Final%20Chemistry%20BG.png`,
      role: "Chemistry background (final)",
    },
    background_alt: {
      filename: "Blur BG for Chemistry.jpg",
      url: `${GITHUB_RAW}/Blur%20BG%20for%20Chemistry.jpg`,
      role: "Chemistry blurred background (alternative)",
    },
    intro_video: {
      filename: "Chemistry intro.mp4",
      url: `${GITHUB_RAW}/Chemistry%20intro.mp4`,
      role: "Chemistry subject intro video — plays before scene 1",
    },
  },
};

/**
 * Returns the subject-specific assets for a given subject string.
 * Falls back to a default set using the generic blurred BG and no intro.
 */
export function getSubjectAssets(subject: string): SubjectAssets {
  const key = subject.trim().toLowerCase();
  if (SUBJECT_ASSETS[key]) return SUBJECT_ASSETS[key];

  // Partial match (e.g. "Biology - Grade 10" → "biology")
  for (const [k, v] of Object.entries(SUBJECT_ASSETS)) {
    if (key.includes(k)) return v;
  }

  // Fallback: generic
  return {
    background: COMMON_ASSETS.default_bg,
    intro_video: {
      filename: "",
      url: "",
      role: "No subject-specific intro available",
    },
  };
}

/**
 * Returns every fixed filename that should go into fixed_assets/ in the ZIP.
 * Excludes template files (those go to template/ instead).
 */
export function getAllFixedFilenames(subject: string): string[] {
  const sa = getSubjectAssets(subject);
  const files = [
    COMMON_ASSETS.logo_transparent.filename,
    COMMON_ASSETS.piced_logo.filename,
    COMMON_ASSETS.clipboard.filename,
    COMMON_ASSETS.audio_jingle.filename,
    COMMON_ASSETS.default_bg.filename,
    COMMON_ASSETS.presenter_video.filename,
    sa.background.filename,
    sa.intro_video.filename,
  ];
  if (sa.background_alt) files.push(sa.background_alt.filename);

  // Deduplicate & remove empty
  return [...new Set(files.filter(Boolean))];
}

/**
 * Returns every FixedFile object that should be downloaded for the ZIP.
 * Excludes template files.
 */
export function getAllFixedFiles(subject: string): FixedFile[] {
  const sa = getSubjectAssets(subject);
  const all: FixedFile[] = [
    COMMON_ASSETS.logo_transparent,
    COMMON_ASSETS.piced_logo,
    COMMON_ASSETS.clipboard,
    COMMON_ASSETS.audio_jingle,
    COMMON_ASSETS.default_bg,
    COMMON_ASSETS.presenter_video,
    sa.background,
    sa.intro_video,
  ];
  if (sa.background_alt) all.push(sa.background_alt);

  // Deduplicate by filename & remove empty, exclude templates
  const seen = new Set<string>();
  return all.filter((f) => {
    if (!f.filename || seen.has(f.filename) || f.isTemplate) return false;
    seen.add(f.filename);
    return true;
  });
}

/**
 * Returns the template FixedFile (the .aep) for inclusion in the ZIP.
 */
export function getTemplateFile(): FixedFile {
  return COMMON_ASSETS.template_aep;
}
