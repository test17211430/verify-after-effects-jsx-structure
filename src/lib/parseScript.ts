import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface StructuredScriptScene {
  sourceIndex: number;
  frame: string;
  audio: string;
  visualization: string;
  header: string;
  body: string;
  imageUrls: string[];
}

function normalizeWhitespace(value: string): string {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanUrl(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/[),.;:!?]+$/g, "")
    .trim();
}

/**
 * Finds image URLs in scripts, including Google Drive links and URLs whose
 * image extension is followed by a query string.
 */
export function extractImageUrls(text: string): string[] {
  const matches = String(text || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const urls = matches
    .map(cleanUrl)
    .filter((url) =>
      /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i.test(url) ||
      /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?)/i.test(url)
    );
  return Array.from(new Set(urls));
}

function extractLabeledSection(
  text: string,
  labels: string[],
  stopLabels: string[]
): string {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const escapedStops = stopLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const stopPattern = escapedStops.length
    ? `(?=\\n\\s*(?:${escapedStops.join("|")})[^\\n:]*\\s*:|$)`
    : "$";
  const regex = new RegExp(
    `(?:^|\\n)\\s*(?:${escapedLabels.join("|")})\\s*:\\s*([\\s\\S]*?)${stopPattern}`,
    "i"
  );
  const match = String(text || "").match(regex);
  return normalizeWhitespace(match ? match[1] : "");
}

/**
 * Parses the structured scene blocks produced by DOCX extraction. This gives
 * normalization a deterministic fallback when an AI response omits rows.
 */
export function extractStructuredScriptScenes(text: string): StructuredScriptScene[] {
  const source = String(text || "");
  const marker = /---\s*SCRIPT SCENE\s+(\d+)\s*---/gi;
  const markers: Array<{ index: number; sourceIndex: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = marker.exec(source))) {
    markers.push({
      index: match.index,
      sourceIndex: Number(match[1]),
      end: marker.lastIndex,
    });
  }

  const scenes: StructuredScriptScene[] = [];
  for (let i = 0; i < markers.length; i++) {
    const current = markers[i];
    const block = source.slice(current.end, markers[i + 1]?.index ?? source.length);
    const frame = extractLabeledSection(block, ["FRAME/LAYOUT"], ["AUDIO CUES"]);
    const audio = extractLabeledSection(
      block,
      ["AUDIO CUES (Narration/Subtitles)", "AUDIO CUES"],
      ["VISUALIZATION / TEXT ON SCREEN"]
    );
    const visualization = extractLabeledSection(
      block,
      ["VISUALIZATION / TEXT ON SCREEN"],
      []
    );
    const header = extractLabeledSection(
      visualization,
      ["Null Screen Header", "Screen Header", "Header", "Title Text"],
      [
        "Body Text",
        "Audio/Animation Cues",
        "Visual/Animation Instructions",
        "Image",
        "Image Suggestion",
      ]
    );
    const body = extractLabeledSection(
      visualization,
      ["Body Text"],
      [
        "Audio/Animation Cues",
        "Visual/Animation Instructions",
        "Image",
        "Image Suggestion",
      ]
    );

    scenes.push({
      sourceIndex: current.sourceIndex,
      frame,
      audio,
      visualization,
      header,
      body,
      imageUrls: extractImageUrls(visualization),
    });
  }

  return scenes;
}

/**
 * Extract text from a PDF file
 */
async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    textParts.push(pageText);
  }
  
  return textParts.join("\n\n");
}

/**
 * Extract text from a DOCX file
 */
async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  // Using convertToHtml preserves table structures (like "Audio Cues" columns) for the LLM
  const result = await mammoth.convertToHtml({ arrayBuffer });
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(result.value, "text/html");
    const tables = Array.from(doc.querySelectorAll('table'));
    
    let structuredText = "";
    let metadataText = "";
    let tableParsed = false;

    const getCleanText = (html: string) => {
      let text = html.replace(/<br\s*\/?>/gi, "\n");
      text = text.replace(/<\/p>/gi, "\n");
      text = text.replace(/<\/li>/gi, "\n");
      text = text.replace(/<\/?[^>]+(>|$)/g, " ");
      const temp = doc.createElement("div");
      temp.innerHTML = text;
      return normalizeWhitespace(temp.textContent || "");
    };
    
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length === 0) continue;
      
      const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map((td) =>
        normalizeWhitespace(td.textContent || "")
      );
      const normalizedHeaders = headerCells.map((header) => header.toLowerCase());
      const audioIndex = normalizedHeaders.findIndex((header) => /audio\s*cues?/.test(header));
      const frameIndex = normalizedHeaders.findIndex((header) => /^frame(?:\b|\/)/.test(header));
      const visualizationIndex = normalizedHeaders.findIndex((header) =>
        /visuali[sz]ation|text\s*on\s*screen|comments/.test(header)
      );

      if (
        rows.length > 1 &&
        rows.every((row) => row.querySelectorAll("th, td").length >= 2) &&
        audioIndex < 0 &&
        frameIndex < 0
      ) {
        const metadataRows: string[] = [];
        for (const row of rows) {
          const cols = Array.from(row.querySelectorAll("th, td"));
          if (cols.length < 2) continue;
          const key = getCleanText(cols[0].innerHTML);
          const value = getCleanText(cols[1].innerHTML);
          if (key && value) metadataRows.push(`${key}: ${value}`);
        }
        if (metadataRows.length >= 3) {
          metadataText += `### LESSON METADATA\n${metadataRows.join("\n")}\n\n`;
        }
      }

      if (audioIndex >= 0 && frameIndex >= 0 && visualizationIndex >= 0) {
        tableParsed = true;
        structuredText += "### SCRIPT SCENES (Extracted from Table)\n\n";

        for (let i = 1; i < rows.length; i++) {
          const cols = Array.from(rows[i].querySelectorAll('th, td'));
          if (cols.length > Math.max(audioIndex, frameIndex, visualizationIndex)) {
            const audio = getCleanText(cols[audioIndex].innerHTML);
            const frame = getCleanText(cols[frameIndex].innerHTML);
            const viz = getCleanText(cols[visualizationIndex].innerHTML);
            
            structuredText += `--- SCRIPT SCENE ${i} ---\n`;
            structuredText += `FRAME/LAYOUT: ${frame}\n`;
            structuredText += `AUDIO CUES (Narration/Subtitles):\n${audio}\n`;
            structuredText += `VISUALIZATION / TEXT ON SCREEN:\n${viz}\n\n`;
          }
        }
      }
    }
    
    if (tableParsed) {
      return metadataText + structuredText;
    }
  } catch (e) {
    console.warn("Could not parse DOCX tables into structured markdown, falling back to raw HTML", e);
  }

  return result.value;
}

/**
 * Extract text from a plain text file
 */
async function extractTextFromTxt(file: File): Promise<string> {
  return await file.text();
}

/**
 * Extract text from any supported script file (PDF, DOCX, TXT, MD)
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split(".").pop();
  
  switch (ext) {
    case "pdf":
      return extractTextFromPdf(file);
    case "docx":
      return extractTextFromDocx(file);
    case "txt":
    case "md":
      return extractTextFromTxt(file);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * Extracted metadata from a lesson script
 */
export interface ScriptMetadata {
  subject: string;
  chapter: string;
  topic: string;
  video_title: string;
  learning_objective: string;
  teacher_name: string;
  teacher_role: string;
}

/**
 * Use Groq to extract metadata from the script text
 */
export async function extractMetadataFromScript(
  apiKey: string,
  scriptText: string
): Promise<ScriptMetadata> {
  const systemPrompt = `You are a document parser. Extract lesson metadata from educational scripts.
Return a JSON object with these fields:
- subject: The subject/course name (e.g., "Biology", "Chemistry", "Physics", "Mathematics")
- chapter: The chapter name or number
- topic: The specific topic of the lesson
- video_title: A good title for the video
- learning_objective: What the student will learn
- teacher_name: Name of the teacher if mentioned (or empty string)
- teacher_role: Role of the teacher if mentioned (or empty string)

Look for these patterns to identify fields:
- Subject is often at the top, or in headers like "Subject:", "Course:", "Class:"
- Chapter may be labeled "Chapter", "Unit", "Module"
- Topic may be labeled "Topic:", "Lesson:", "Title:"
- Teacher name may appear as "By:", "Instructor:", "Teacher:", "Presented by:", or in signatures
- Learning objectives may be labeled "Objective:", "Learning Outcome:", "Students will learn:"

If a field cannot be determined, use your best guess based on the content.
Return ONLY valid JSON, no other text.`;

  const userPrompt = `Extract metadata from this lesson script:\n\n${scriptText.slice(0, 8000)}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content || "{}";
  
  try {
    const parsed = JSON.parse(content);
    return {
      subject: parsed.subject || "",
      chapter: parsed.chapter || "",
      topic: parsed.topic || "",
      video_title: parsed.video_title || "",
      learning_objective: parsed.learning_objective || "",
      teacher_name: parsed.teacher_name || "",
      teacher_role: parsed.teacher_role || "Teacher",
    };
  } catch {
    // If parsing fails, return defaults with the script text
    return {
      subject: "",
      chapter: "",
      topic: "",
      video_title: "",
      learning_objective: "",
      teacher_name: "",
      teacher_role: "Teacher",
    };
  }
}
