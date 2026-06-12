import type { FormMeta, LessonManifest } from "./sceneSchema";

async function throwGroqError(response: Response): Promise<never> {
  const errText = await response.text();
  throw new Error(`Groq API error: ${response.status} - ${errText}`);
}

function shouldRetryWithNextKey(response: Response): boolean {
  return response.status === 413 || response.status === 429;
}

/**
 * Builds the prompt messages for the Groq API call.
 * Updated to use Dental Formula template scene types and request
 * subtitles + timed body steps.
 */
function buildPrompt(
  meta: FormMeta,
  lessonText: string,
  imageNames: string[],
  hasVoiceover: boolean,
  fixedAssetNames: string[]
): Array<{ role: string; content: string }> {
  const imageBlock =
    imageNames.length > 0
      ? imageNames.map((n) => `- ${n}`).join("\n")
      : "(no images uploaded)";

  const fixedBlock = fixedAssetNames.map((n) => `- ${n}`).join("\n");

  const system = `You are a senior instructional video planner for After Effects lesson videos built with the Dental Formula template.
Turn raw lesson content into a clean scene-by-scene plan that matches the template architecture.
Keep the scene flow suitable for school learners.

SCENE TYPES — Use ONLY these types (they map to template segments with fixed timings):
- "title" (6.36s) — Title card with topic name and subject. Always first scene.
- "center" (7.48s) — Teacher in center, no clipboard. Used for teacher introduction.
- "pair" (8.60s) — Two-image comparison board with labels. Used for "Previously" or comparisons. Requires exactly 2 images in image_files.
- "single" (7.20s) — Single image on clipboard board with header and body text.
- "triple" (12.60s) — Timed image sequence on clipboard. Best for multi-step processes. Supports body_steps for timed text.
- "summary" (12.60s) — Summary board with overview graphic.
- "outro" (2.44s) — Closing card. Always last scene.

IMPORTANT RULES:
- First scene MUST be "title", last scene MUST be "outro"
- Second scene should usually be "center" (teacher intro with lower_third_main/lower_third_sub)
- Prefer 6 to 10 scenes total
- Match images to lesson meaning
- For "triple" scenes, provide body_steps array with timed text that appears/disappears
- For every scene, provide subtitles array with timed narration blocks
- Subtitle times are relative to scene start (0 = scene begins)
- For "pair" scenes, provide left_label and right_label
- CRITICAL: Process the ENTIRE script from start to finish. Do NOT truncate or stop early. Create as many scenes as necessary up to 40.

The following fixed template assets are AUTOMATICALLY included by the JSX generator.
Do NOT reference them in image_files:
${fixedBlock}

Specifically:
- A subject-specific BACKGROUND IMAGE is behind every scene automatically
- A subject-specific INTRO VIDEO plays BEFORE scene 1 (do NOT create a scene for it)
- A LOGO overlay is placed top-right on every scene automatically
- A CLIPBOARD graphic is used as the board background on "single" and "triple" scenes
- An AUDIO JINGLE plays on intro and outro automatically
- A PRESENTER VIDEO is used as teacher fallback if none provided

Only reference user-uploaded images in image_files arrays.
Return only valid JSON.`;

  const user = `Project metadata:
Subject: ${meta.subject}
Chapter: ${meta.chapter}
Topic: ${meta.topic}
Video title: ${meta.video_title}
Teacher name: ${meta.teacher_name}
Teacher role: ${meta.teacher_role}
Has voiceover file: ${String(hasVoiceover)}

Available user-uploaded image files:
${imageBlock}

Lesson source text:
${lessonText}

Create a polished lesson video plan with:
- Title card (first scene, type "title")
- Teacher introduction (type "center") with lower_third_main set to "${meta.teacher_name || "Teacher"}" and lower_third_sub set to "${meta.teacher_role || "Teacher"}"
- Content scenes using "single" for focused topics and "triple" for multi-step processes
- Use "pair" if comparing two concepts (needs exactly 2 images)
- Summary scene (type "summary") near the end
- Outro (last scene, type "outro")
- Each scene needs subtitles array with timed narration blocks
- Each "triple" scene should have body_steps array with timed text segments
- Subtitle and body_step times are relative to scene start
- body text suitable for on-screen captions
- narration that reads naturally
- Estimate realistic timing for subtitles based on a normal speaking rate (~2.5 words per second).
- Set the scene duration to comfortably fit the audio cues. DO NOT USE FIXED DURATIONS!

CRITICAL MAPPING INSTRUCTIONS FOR WORD DOCUMENT TEXT:
When reading the "Lesson source text" (which is formatted as SCRIPT SCENE markdown blocks or raw text), strictly adhere to these mapping rules:
1. Map ALL text under "AUDIO CUES (Narration/Subtitles):" strictly to the "subtitles" array by breaking it down into timed subtitle blocks. Do not miss any spoken text!
2. Under "VISUALIZATION / TEXT ON SCREEN:", find "Null Screen Header:" or "Title Text:" and map it EXACTLY to the "header" field of the scene.
3. Under "VISUALIZATION / TEXT ON SCREEN:", find "Body Text:" and map it EXACTLY to the "body" field (or "body_steps" if it's a triple scene).
4. Use the "FRAME/LAYOUT:" and "Audio/Animation Cues:" to decide which template/scene layout to use and what image to place.
5. NO HEADER OR BODY TEXT from the script should be missed. Include everything exactly as provided.
6. PROCESS THE ENTIRE SCRIPT. DO NOT STOP EARLY. DO NOT SUMMARIZE. Every single scene from the source text MUST be converted into a scene in the JSON output!

The AE output uses 1920x1080, 25 fps.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Builds the JSON schema for the Groq response.
 * Updated with new scene types, subtitles, body_steps, and pair labels.
 */
function buildSceneSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      project_name: { type: "string" },
      subject: { type: "string" },
      chapter: { type: "string" },
      topic: { type: "string" },
      video_title: { type: "string" },
      learning_objective: { type: "string" },
      teacher: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          role: { type: "string" },
        },
        required: ["name", "role"],
      },
      ae: {
        type: "object",
        additionalProperties: false,
        properties: {
          master_comp_name: { type: "string" },
          scene_comp_prefix: { type: "string" },
          width: { type: "integer" },
          height: { type: "integer" },
          fps: { type: "number" },
        },
        required: ["master_comp_name", "scene_comp_prefix", "width", "height", "fps"],
      },
      asset_plan: {
        type: "object",
        additionalProperties: false,
        properties: {
          teacher_video: { type: "string" },
          voiceover: { type: ["string", "null"] },
          images: { type: "array", items: { type: "string" } },
        },
        required: ["teacher_video", "voiceover", "images"],
      },
      scenes: {
        type: "array",
        minItems: 4,
        maxItems: 40,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: ["title", "center", "pair", "single", "triple", "summary", "outro"],
            },
            duration: { type: "number" },
            title: { type: "string" },
            header: { type: "string" },
            body: { type: "string" },
            narration: { type: "string" },
            visual_cues: { type: "string" },
            image_files: { type: "array", items: { type: "string" } },
            on_screen_text: { type: "string" },
            layout_note: { type: "string" },
            subtitles: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  start: { type: "number" },
                  end: { type: "number" },
                  text: { type: "string" },
                },
                required: ["start", "end", "text"],
              },
            },
            body_steps: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  start: { type: "number" },
                  end: { type: "number" },
                  text: { type: "string" },
                },
                required: ["start", "end", "text"],
              },
            },
            left_label: { type: "string" },
            right_label: { type: "string" },
            lower_third_main: { type: "string" },
            lower_third_sub: { type: "string" },
          },
          required: [
            "id", "type", "duration", "title", "header", "body", "narration",
            "visual_cues", "image_files", "on_screen_text", "layout_note",
            "subtitles",
          ],
        },
      },
    },
    required: [
      "project_name", "subject", "chapter", "topic", "video_title",
      "learning_objective", "teacher", "ae", "asset_plan", "scenes",
    ],
  };
}

/**
 * Calls Groq API to generate a lesson plan.
 * Now requests subtitles, body_steps, and uses Dental Formula scene types.
 */
export async function groqGeneratePlan(
  apiKey: string,
  meta: FormMeta,
  lessonText: string,
  imageNames: string[],
  hasVoiceover: boolean,
  fixedAssetNames: string[],
  model: string = "llama-3.3-70b-versatile"
): Promise<Partial<LessonManifest>> {
  const messages = buildPrompt(meta, lessonText, imageNames, hasVoiceover, fixedAssetNames);
  const schema = buildSceneSchema();

  const body: any = {
    model,
    messages,
    temperature: 0.1,
    max_completion_tokens: 16000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lesson_plan",
        schema,
        strict: true,
      },
    },
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (shouldRetryWithNextKey(response)) {
      await throwGroqError(response);
    }

    // Fallback to json_object mode
    body.response_format = { type: "json_object" };
    const fallback = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!fallback.ok) {
      await throwGroqError(fallback);
    }
    const fallbackData = await fallback.json();
    return JSON.parse(fallbackData.choices[0].message.content || "{}");
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content || "{}");
}
