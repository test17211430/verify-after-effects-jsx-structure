import type { FormMeta, LessonManifest, Scene, SceneType } from "./sceneSchema";
import { SEGMENTS, SCENE_TYPES } from "./sceneSchema";
import { COMMON_ASSETS, getSubjectAssets } from "./fixedAssets";
import { extractStructuredScriptScenes } from "./parseScript";

function slugify(value: string): string {
  let v = (value || "lesson").trim().toLowerCase();
  v = v.replace(/[^a-z0-9]+/g, "-");
  v = v.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return v || "lesson";
}

/**
 * Maps old scene types to new Dental Formula types.
 */
function mapSceneType(type: string): SceneType {
  if (type === "wide" || type === "wide_with_image") return "single";
  if ((SCENE_TYPES as readonly string[]).includes(type)) return type as SceneType;
  return "single";
}

/**
 * Returns the template segment duration for a scene type.
 */
function getSegmentDuration(type: SceneType): number {
  switch (type) {
    case "title": return SEGMENTS.title.playDuration;
    case "outro": return SEGMENTS.outro.playDuration;
    case "pair": return SEGMENTS.pair.playDuration;
    case "center": return SEGMENTS.center.playDuration;
    case "single": return SEGMENTS.single.playDuration;
    case "triple": return SEGMENTS.triple.playDuration;
    case "summary": return SEGMENTS.triple.playDuration;
    default: return SEGMENTS.single.playDuration;
  }
}

function cleanText(value: string): string {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Removes script-only annotations that must never be rendered on screen or in
 * subtitles: section labels (VISUALIZATION / TEXT ON SCREEN, Audio/animation
 * cues, etc.), timing references (0:00–0:07), and production/editor directives
 * (cut the clip, scene duration notes). Applied to every scene's visible text.
 */
function stripProductionNotes(value: string): string {
  const keptLines = String(value || "")
    .split(/\r?\n/)
    .map((rawLine) => {
      let line = rawLine;

      line = line.replace(/\b\d{1,2}\s*:\s*\d{2}\s*[–—-]\s*\d{1,2}\s*:\s*\d{2}\b/g, " ");
      line = line.replace(/\b\d{1,2}\s*:\s*\d{2}\b/g, " ");

      if (
        /^\s*(?:visuali[sz]ation|visual\s*\/?\s*animation instructions?|production notes?|editor(?:'|’)?s? notes?|scene timing|timestamp references?|frame\s*\/?\s*layout)\b/i.test(line)
      ) {
        return "";
      }

      line = line.replace(
        /^\s*(?:text on screen|null screen header|screen header|body text|header|title text|audio\s*\/?\s*animation cues?|audio cues?)\s*:?\s*/i,
        ""
      );

      if (
        /^\s*(?:fade|animate|move|slide|zoom|cut|transition|place|position|show|display)\b/i.test(line) ||
        /\b(?:add|insert)\s+(?:the\s+)?transcript\b/i.test(line)
      ) {
        return "";
      }

      return line;
    })
    .filter(Boolean);

  let v = keptLines.join("\n");

  // Section / column labels, with or without a trailing colon.
  const labels = [
    "visuali[sz]ation\\s*/\\s*text on screen",
    "text on screen",
    "visuali[sz]ations?",
    "audio cues\\s*\\(narration\\s*/\\s*subtitles\\)",
    "audio\\s*/?\\s*animation cues",
    "audio cues",
    "animation cues",
    "visual\\s*/?\\s*animation instructions",
    "frame\\s*/\\s*layout",
    "null screen header",
    "screen header",
    "body text",
    "image suggestions?",
    "production notes?",
    "editor(?:'|’)?s? notes?",
    "scene timing",
    "timestamp references?",
  ];
  v = v.replace(new RegExp("\\b(?:" + labels.join("|") + ")\\b\\s*:?", "gi"), " ");

  // Timing references such as 0:00-0:07 / 0:00 – 0:15 and standalone m:ss.
  v = v.replace(/\b\d{1,2}\s*:\s*\d{2}\s*[–—-]\s*\d{1,2}\s*:\s*\d{2}\b/g, " ");
  v = v.replace(/\b\d{1,2}\s*:\s*\d{2}\b/g, " ");

  // Common editor / production directives.
  v = v.replace(/\bcut the clip\b/gi, " ");
  v = v.replace(/\bcut clip\b/gi, " ");
  v = v.replace(/\b(?:add|insert)\s+(?:the\s+)?transcript\b/gi, " ");
  v = v.replace(/\bscene duration\b[^.\n]*/gi, " ");
  v = v.replace(/\bduration\b\s*:?\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds)?\b/gi, " ");

  return cleanText(v);
}

function normalizeAliasKey(value: string): string {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/[),.;:!?]+$/g, "")
    .trim();
}

function chunkNarration(narration: string, maxWords = 18): string[] {
  const clean = cleanText(narration).replace(/\n+/g, " ");
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      chunks.push(sentence);
      continue;
    }
    for (let i = 0; i < words.length; i += maxWords) {
      chunks.push(words.slice(i, i + maxWords).join(" "));
    }
  }
  return chunks;
}

function spokenDuration(text: string, minimum: number): number {
  const wordCount = cleanText(text).split(/\s+/).filter(Boolean).length;
  return Math.max(minimum, Math.ceil((wordCount / 2.5 + 0.6) * 100) / 100);
}

/**
 * Generates default subtitles from narration text for a scene.
 */
function generateDefaultSubtitles(narration: string, duration: number) {
  const chunks = chunkNarration(narration);
  if (chunks.length === 0) return [];

  const blocks: Array<{ start: number; end: number; text: string }> = [];
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  for (let i = 0; i < chunks.length; i++) {
    const blockDuration = duration * (weights[i] / totalWeight);
    blocks.push({
      start: Math.round(cursor * 100) / 100,
      end: i === chunks.length - 1
        ? duration
        : Math.round((cursor + blockDuration) * 100) / 100,
      text: chunks[i],
    });
    cursor += blockDuration;
  }
  return blocks;
}

/**
 * Generates default body_steps from body text for triple scenes.
 */
function generateDefaultBodySteps(body: string, duration: number) {
  if (!body || !body.trim()) return [];
  const lines = cleanText(body)
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[\u2022-]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];

  const steps: Array<{ start: number; end: number; text: string }> = [];
  const timePerStep = duration / lines.length;
  for (let i = 0; i < lines.length; i++) {
    steps.push({
      start: Math.round(timePerStep * i * 100) / 100,
      end: Math.round(timePerStep * (i + 1) * 100) / 100,
      text: lines[i].trim(),
    });
  }
  return steps;
}

function inferSceneType(frame: string, header: string, imageCount: number, body: string): SceneType {
  const frameText = cleanText(frame).toLowerCase();
  const headerText = cleanText(header).toLowerCase();
  if (/outro|closing/.test(frameText)) return "outro";
  if (/title/.test(frameText)) return "title";
  if (/summary/.test(frameText)) return "summary";
  if (/^wide$|teacher.*cent(?:er|re)/.test(frameText)) return "center";
  if (/previous|compare|versus|\bvs\b/.test(headerText) && imageCount >= 2) return "pair";
  const bodyLines = cleanText(body).split(/\r?\n+/).filter(Boolean).length;
  if (imageCount > 1 || bodyLines > 2) return "triple";
  return "single";
}

function defaultHeader(type: SceneType, topic: string): string {
  if (type === "title") return topic;
  if (type === "center") return "";
  if (type === "summary") return "Summary";
  if (type === "outro") return "Thank You";
  return topic;
}

function buildScenesFromStructuredScript(
  sourceText: string,
  result: any,
  meta: FormMeta,
  imageAliases: Record<string, string>
): Scene[] {
  const extracted = extractStructuredScriptScenes(sourceText);
  if (!extracted.length) return [];

  const scenes: Scene[] = extracted.map((sourceScene, index) => {
    const mappedImages = sourceScene.imageUrls
      .map((url) => imageAliases[normalizeAliasKey(url)] || "")
      .filter(Boolean);
    const type = inferSceneType(
      sourceScene.frame,
      sourceScene.header,
      mappedImages.length || sourceScene.imageUrls.length,
      sourceScene.body
    );
    const minDuration = getSegmentDuration(type);
    const placeholderAudio = /add (?:the )?transcript|insert (?:the )?transcript/i.test(sourceScene.audio);
    const narration = placeholderAudio
      ? (type === "title" ? result.video_title : "")
      : stripProductionNotes(sourceScene.audio);
    const duration = type === "title" || type === "outro"
      ? minDuration
      : spokenDuration(narration, minDuration);
    let header = stripProductionNotes(sourceScene.header);
    if (type === "title") header = result.video_title || header;
    if (!header) header = defaultHeader(type, result.topic || meta.topic || "");
    const body = stripProductionNotes(sourceScene.body);
    const bodySteps = type === "triple" ? generateDefaultBodySteps(body, duration) : [];

    const scene: Scene = {
      id: `scene_${String(index + 1).padStart(2, "0")}`,
      type,
      duration,
      title: header,
      header,
      body,
      narration,
      visual_cues: cleanText(sourceScene.visualization),
      image_files: mappedImages,
      on_screen_text: header,
      layout_note: cleanText(sourceScene.frame),
      subtitles: generateDefaultSubtitles(narration, duration),
      body_steps: bodySteps,
    };

    if (type === "center") {
      scene.lower_third_main = meta.teacher_name || result.teacher?.name || "";
      scene.lower_third_sub = meta.teacher_role || result.teacher?.role || "";
    }
    if (type === "pair") {
      const pairText = `${header} ${body}`.toLowerCase();
      if (pairText.includes("autotroph") && pairText.includes("heterotroph")) {
        scene.left_label = "Autotroph";
        scene.right_label = "Heterotroph";
      }
    }
    return scene;
  });

  if (scenes[0]?.type !== "title") {
    scenes.unshift({
      id: "scene_00",
      type: "title",
      duration: SEGMENTS.title.playDuration,
      title: result.video_title,
      header: result.video_title,
      body: "",
      narration: result.video_title,
      visual_cues: "Title card",
      image_files: [],
      on_screen_text: result.video_title,
      layout_note: "Title screen",
      subtitles: generateDefaultSubtitles(result.video_title, SEGMENTS.title.playDuration),
    });
  }

  if (scenes[scenes.length - 1]?.type !== "outro") {
    scenes.push({
      id: `scene_${String(scenes.length + 1).padStart(2, "0")}`,
      type: "outro",
      duration: SEGMENTS.outro.playDuration,
      title: "Thank You",
      header: "Thank You",
      body: "",
      narration: "",
      visual_cues: "Template outro with logo and jingle",
      image_files: [],
      on_screen_text: "Thank You",
      layout_note: "Outro screen",
      subtitles: [],
    });
  }

  return scenes.map((scene, index) => ({
    ...scene,
    id: `scene_${String(index + 1).padStart(2, "0")}`,
  }));
}

export function normalizePlan(
  plan: Partial<LessonManifest>,
  meta: FormMeta,
  teacherVideoName: string,
  imageNames: string[],
  voiceoverName: string | null,
  teacherVideoBackground: "green_screen" | "white_or_light" = "white_or_light",
  sourceText = "",
  imageAliases: Record<string, string> = {}
): LessonManifest {
  const result: any = { ...(plan || {}) };
  const topicSlug = slugify(meta.topic || result.topic || "lesson");
  const subjectAssets = getSubjectAssets(meta.subject || result.subject || "");

  result.project_name =
    result.project_name || `${meta.subject || "Lesson"} - ${meta.topic || "Topic"}`;
  result.subject = result.subject || meta.subject || "";
  result.chapter = result.chapter || meta.chapter || "";
  result.topic = result.topic || meta.topic || "";
  result.video_title =
    result.video_title || meta.video_title || `${meta.topic || "Lesson"} Video`;
  result.learning_objective = result.learning_objective || meta.learning_objective || "";

  result.teacher = result.teacher || {
    name: meta.teacher_name || "Teacher",
    role: meta.teacher_role || "teacher",
  };

  result.ae = result.ae || {
    master_comp_name: `${topicSlug}_Auto_Master`,
    scene_comp_prefix: "SC_",
    width: 1920,
    height: 1080,
    fps: 25,
  };

  // Build fixed asset plan from subject mapping
  const fixedPlan: any = {
    logo: COMMON_ASSETS.logo_transparent.filename,
    piced_logo: COMMON_ASSETS.piced_logo.filename,
    clipboard: COMMON_ASSETS.clipboard.filename,
    audio_jingle: COMMON_ASSETS.audio_jingle.filename,
    background: subjectAssets.background.filename,
    intro_video: subjectAssets.intro_video.filename,
    presenter_video: COMMON_ASSETS.presenter_video.filename,
    template_aep: COMMON_ASSETS.template_aep?.filename || "Dental Formula (converted).aep",
  };
  if (subjectAssets.background_alt) {
    fixedPlan.background_alt = subjectAssets.background_alt.filename;
  }

  result.asset_plan = {
    ...(result.asset_plan || {}),
    teacher_video: teacherVideoName,
    teacher_video_background: teacherVideoBackground,
    voiceover: voiceoverName,
    images: imageNames,
    fixed: fixedPlan,
  };

  let scenes: Scene[] = result.scenes || [];
  const structuredScenes = buildScenesFromStructuredScript(sourceText, result, meta, imageAliases);
  if (structuredScenes.length > 0) {
    scenes = structuredScenes;
  }

  // If AI returned no scenes, generate a default plan
  if (scenes.length === 0) {
    const teacherName = meta.teacher_name || result.teacher?.name || "Teacher";
    const teacherRole = meta.teacher_role || result.teacher?.role || "Teacher";

    scenes = [
      {
        id: "scene_01",
        type: "title",
        duration: SEGMENTS.title.playDuration,
        title: result.video_title,
        body: result.learning_objective,
        narration: result.video_title,
        visual_cues: "Title card with topic name and subject — template intro plays first",
        image_files: [],
        on_screen_text: result.video_title,
        layout_note: "Title screen — template handles intro video, PicEd logo, and audio jingle",
        subtitles: [{ start: 0, end: SEGMENTS.title.playDuration, text: result.video_title }],
      },
      {
        id: "scene_02",
        type: "center",
        duration: SEGMENTS.center.playDuration,
        title: "Introduction",
        body: result.learning_objective || "",
        narration: `Hello learners, my name is ${teacherName}, your ${teacherRole}.`,
        visual_cues: "Teacher in center, no clipboard",
        image_files: [],
        on_screen_text: "",
        layout_note: "Teacher introduction with lower-third nameplate",
        lower_third_main: teacherName,
        lower_third_sub: teacherRole,
        subtitles: [{
          start: 0,
          end: SEGMENTS.center.playDuration,
          text: `Hello learners, my name is ${teacherName}, your ${teacherRole}.`,
        }],
      },
      {
        id: "scene_03",
        type: "single",
        duration: SEGMENTS.single.playDuration,
        title: "Today",
        body: result.topic || "",
        narration: `In today's session, we are going to learn about ${result.topic || "the topic"}.`,
        visual_cues: "Single image on clipboard board",
        image_files: imageNames.slice(0, 1),
        on_screen_text: "Today",
        layout_note: "Single board with header and body text",
        subtitles: [{
          start: 0,
          end: SEGMENTS.single.playDuration,
          text: `In today's session, we are going to learn about ${result.topic || "the topic"}.`,
        }],
      },
      {
        id: "scene_04",
        type: "triple",
        duration: SEGMENTS.triple.playDuration,
        title: "Key Concepts",
        body: result.learning_objective || "",
        narration: result.learning_objective || "",
        visual_cues: "Multi-image sequence on clipboard board",
        image_files: imageNames.slice(0, 3),
        on_screen_text: "Key Concepts",
        layout_note: "Triple board with timed image sequence",
        subtitles: generateDefaultSubtitles(
          result.learning_objective || "",
          SEGMENTS.triple.playDuration
        ),
        body_steps: generateDefaultBodySteps(
          result.learning_objective || "",
          SEGMENTS.triple.playDuration
        ),
      },
      {
        id: "scene_05",
        type: "summary",
        duration: SEGMENTS.triple.playDuration,
        title: "Summary",
        body: `In summary, we have learned about ${result.topic || "the topic"}.`,
        narration: `In summary, we have learned about ${result.topic || "the topic"}.`,
        visual_cues: "Summary overview board",
        image_files: imageNames.slice(0, 1),
        on_screen_text: "Summary",
        layout_note: "Summary board with overview graphic",
        subtitles: [{
          start: 0,
          end: SEGMENTS.triple.playDuration,
          text: `In summary, we have learned about ${result.topic || "the topic"}.`,
        }],
      },
      {
        id: "scene_06",
        type: "outro",
        duration: SEGMENTS.outro.playDuration,
        title: "Thank You",
        body: "",
        narration: "Thank you for watching.",
        visual_cues: "Outro with PicEd logo and jingle",
        image_files: [],
        on_screen_text: "Thank You",
        layout_note: "Outro — template handles PicEd logo and audio jingle",
        subtitles: [],
      },
    ];
  }

  // Normalize each scene
  for (let idx = 0; idx < scenes.length; idx++) {
    const scene = scenes[idx];
    // Map old types to new types
    scene.type = mapSceneType(scene.type);

    scene.id = scene.id || `scene_${String(idx + 1).padStart(2, "0")}`;
    scene.title = scene.title || "";
    scene.header = scene.header || scene.on_screen_text || scene.title || "";
    scene.body = scene.body || "";
    scene.narration = scene.narration || scene.body || "";
    scene.visual_cues = scene.visual_cues || "";
    scene.image_files = scene.image_files || [];
    scene.on_screen_text = scene.on_screen_text || scene.title || "";
    scene.layout_note = scene.layout_note || "";

    // Strip script-only annotations from every visible field so they can never
    // be rendered. Done before subtitle/body_step generation below so derived
    // text stays clean too.
    scene.title = stripProductionNotes(scene.title);
    scene.header = stripProductionNotes(scene.header);
    scene.on_screen_text = stripProductionNotes(scene.on_screen_text);
    scene.body = stripProductionNotes(scene.body);
    scene.narration = stripProductionNotes(scene.narration);
    scene.left_label = stripProductionNotes(scene.left_label || "");
    scene.right_label = stripProductionNotes(scene.right_label || "");
    scene.lower_third_main = stripProductionNotes(scene.lower_third_main || "");
    scene.lower_third_sub = stripProductionNotes(scene.lower_third_sub || "");

    const minDuration = getSegmentDuration(scene.type);
    scene.duration = Math.max(
      scene.duration || minDuration,
      spokenDuration(scene.narration, minDuration)
    );
    
    // Generate default subtitles if missing
    if (!scene.subtitles || scene.subtitles.length === 0) {
      scene.subtitles = generateDefaultSubtitles(scene.narration, scene.duration);
    } else {
      // Sanitize any supplied subtitle text and drop blocks left empty.
      scene.subtitles = scene.subtitles
        .map((s: any) => ({ ...s, text: stripProductionNotes(s.text) }))
        .filter((s: any) => s.text);
      const maxSubEnd = Math.max(...scene.subtitles.map((s: any) => s.end), 0);
      scene.duration = Math.max(scene.duration, maxSubEnd, minDuration);
    }

    // Generate default body_steps for triple scenes if missing
    if (scene.type === "triple" && (!scene.body_steps || scene.body_steps.length === 0)) {
      scene.body_steps = generateDefaultBodySteps(scene.body, scene.duration);
    } else if (scene.body_steps && scene.body_steps.length) {
      scene.body_steps = scene.body_steps
        .map((s: any) => ({ ...s, text: stripProductionNotes(s.text) }))
        .filter((s: any) => s.text);
    }

    // Ensure center scenes have lower_third info
    if (scene.type === "center" && !scene.lower_third_main) {
      scene.lower_third_main = meta.teacher_name || result.teacher?.name || "";
      scene.lower_third_sub = meta.teacher_role || result.teacher?.role || "";
    }
  }

  result.scenes = scenes;
  return result as LessonManifest;
}
