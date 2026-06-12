import { useState, useRef } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { FormMeta, LessonManifest } from "./lib/sceneSchema";
import { SEGMENTS } from "./lib/sceneSchema";
import { normalizePlan } from "./lib/normalizePlan";
import { generateJsx, generateRunnerJsx, generateReadme } from "./lib/generateJsx";
import { groqGeneratePlan } from "./lib/groqApi";
import {
  getAllFixedFilenames,
  getAllFixedFiles,
  getSubjectAssets,
  COMMON_ASSETS,
  SUBJECT_ASSETS,
} from "./lib/fixedAssets";
import { generateInspectionJsx, generateQaFrameExportJsx } from "./lib/generateVerification";
import {
  extractImageUrls,
  extractTextFromFile,
  extractMetadataFromScript,
} from "./lib/parseScript";

function slugify(value: string): string {
  let v = (value || "lesson").trim().toLowerCase();
  v = v.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return v || "lesson";
}

function normalizeSourceUrl(value: string): string {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/[),.;:!?]+$/g, "")
    .trim();
}

function uniqueGroqApiKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  return keys
    .map((key) => key.trim())
    .filter(Boolean)
    .filter((key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isGroqLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /(?:\b413\b|\b429\b|rate[_ -]?limit|tokens per minute|\bTPM\b|request too large|too many requests)/i.test(message);
}

function googleDriveDownloadUrl(url: string): string {
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  const idMatch = url.match(/[?&]id=([^&#]+)/i);
  const id = fileMatch?.[1] || idMatch?.[1];
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : url;
}

function imageFetchCandidates(sourceUrl: string): string[] {
  const normalized = googleDriveDownloadUrl(normalizeSourceUrl(sourceUrl));
  const withoutProtocol = normalized.replace(/^https?:\/\//i, "");
  return [
    normalized,
    `https://corsproxy.io/?${encodeURIComponent(normalized)}`,
    `https://images.weserv.nl/?url=${encodeURIComponent(withoutProtocol)}`,
  ];
}

function imageExtension(url: string, contentType: string): string {
  const pathMatch = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (pathMatch) {
    const ext = pathMatch[1].toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  }
  const type = contentType.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("svg")) return "svg";
  return "jpg";
}

async function downloadScriptImage(sourceUrl: string, index: number): Promise<File | null> {
  for (const candidate of imageFetchCandidates(sourceUrl)) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      const blob = await response.blob();
      const contentType = blob.type || response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) continue;
      const ext = imageExtension(sourceUrl, contentType);
      const file = new File([blob], `Script_Image_${String(index + 1).padStart(2, "0")}.${ext}`, {
        type: contentType,
      });
      (file as any).originalUrl = normalizeSourceUrl(sourceUrl);
      (file as any).assetName = file.name;
      return file;
    } catch {
      // Try the next direct/proxy candidate.
    }
  }
  return null;
}

/** Scene type badge colors */
function sceneTypeBadgeClass(type: string): string {
  switch (type) {
    case "title": return "bg-amber-500/20 text-amber-300";
    case "outro": return "bg-emerald-500/20 text-emerald-300";
    case "center": return "bg-orange-500/20 text-orange-300";
    case "pair": return "bg-cyan-500/20 text-cyan-300";
    case "single": return "bg-blue-500/20 text-blue-300";
    case "triple": return "bg-violet-500/20 text-violet-300";
    case "summary": return "bg-pink-500/20 text-pink-300";
    default: return "bg-gray-500/20 text-gray-300";
  }
}

function App() {
  // Form state
  const [subject, setSubject] = useState("");
  const [chapter, setChapter] = useState("");
  const [topic, setTopic] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [learningObjective, setLearningObjective] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherRole, setTeacherRole] = useState("teacher");
  const [teacherVideoIsGreenScreen, setTeacherVideoIsGreenScreen] = useState(false);
  const [groqApiKey1, setGroqApiKey1] = useState("");
  const [groqApiKey2, setGroqApiKey2] = useState("");
  const [groqApiKey3, setGroqApiKey3] = useState("");
  const [groqApiKey4, setGroqApiKey4] = useState("");
  const [groqApiKey5, setGroqApiKey5] = useState("");
  const [groqApiKey6, setGroqApiKey6] = useState("");

  // Script content (extracted from file)
  const [lessonContent, setLessonContent] = useState("");

  // File refs
  const scriptFileRef = useRef<HTMLInputElement>(null);
  const templateAepRef = useRef<HTMLInputElement>(null);
  const teacherVideoRef = useRef<HTMLInputElement>(null);
  const voiceoverRef = useRef<HTMLInputElement>(null);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);

  // Output state
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{
    manifest: LessonManifest;
    jsxCode: string;
    jobId: string;
  } | null>(null);

  // Derived: current subject's fixed assets
  const subjectAssets = getSubjectAssets(subject);
  const fixedNames = getAllFixedFilenames(subject);
  const groqApiKeys = uniqueGroqApiKeys([
    groqApiKey1,
    groqApiKey2,
    groqApiKey3,
    groqApiKey4,
    groqApiKey5,
    groqApiKey6,
  ]);

  async function runWithGroqKeyFallback<T>(
    label: string,
    action: (apiKey: string, keyIndex: number) => Promise<T>,
    onAttempt?: (keyIndex: number, totalKeys: number) => void
  ): Promise<T> {
    if (groqApiKeys.length === 0) {
      throw new Error("Please enter at least one Groq API key.");
    }

    const errors: string[] = [];
    for (let i = 0; i < groqApiKeys.length; i++) {
      onAttempt?.(i, groqApiKeys.length);
      try {
        return await action(groqApiKeys[i], i);
      } catch (err: any) {
        errors.push(`Key ${i + 1}: ${err.message || String(err)}`);
        if (!isGroqLimitError(err) || i === groqApiKeys.length - 1) {
          throw new Error(`${label} failed. ${errors.join(" | ")}`);
        }
      }
    }

    throw new Error(`${label} failed. ${errors.join(" | ")}`);
  }

  // Handle script file upload — extract text and metadata
  const handleScriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    const file = files[0];
    setParseStatus(`Reading ${file.name}...`);
    setParsing(true);
    setError(null);

    try {
      // Extract text from the file
      const text = await extractTextFromFile(file);
      setLessonContent(text);
      setParseStatus(`Extracted ${text.length} characters. Finding images...`);

      // Automatically find and fetch image URLs from the script
      const urls = extractImageUrls(text);
      
      if (urls.length > 0) {
        setParseStatus(`Downloading ${urls.length} images from script...`);
        const newFiles: File[] = [];
        for (let i = 0; i < urls.length; i++) {
          const downloaded = await downloadScriptImage(urls[i], i);
          if (downloaded) newFiles.push(downloaded);
          else console.warn("Failed to auto-fetch image", urls[i]);
        }
        if (newFiles.length > 0) {
          setUploadedImages((prev) => {
            const existingUrls = new Set(prev.map((f) => normalizeSourceUrl((f as any).originalUrl || "")));
            return [
              ...prev,
              ...newFiles.filter((f) => !existingUrls.has(normalizeSourceUrl((f as any).originalUrl || ""))),
            ];
          });
        }
      }

      setParseStatus(`Parsing metadata with AI...`);

      // Check if we have API key
      if (groqApiKeys.length === 0) {
        setParseStatus("✓ Text extracted. Enter Groq API key to auto-fill metadata.");
        setParsing(false);
        return;
      }

      // Use Groq to extract metadata
      const metadata = await runWithGroqKeyFallback(
        "Metadata extraction",
        (apiKey) => extractMetadataFromScript(apiKey, text),
        (keyIndex, totalKeys) => {
          setParseStatus(`Parsing metadata with AI using key ${keyIndex + 1}/${totalKeys}...`);
        }
      );
      
      // Auto-fill form fields
      if (metadata.subject) setSubject(metadata.subject);
      if (metadata.chapter) setChapter(metadata.chapter);
      if (metadata.topic) setTopic(metadata.topic);
      if (metadata.video_title) setVideoTitle(metadata.video_title);
      if (metadata.learning_objective) setLearningObjective(metadata.learning_objective);
      if (metadata.teacher_name) setTeacherName(metadata.teacher_name);
      if (metadata.teacher_role) setTeacherRole(metadata.teacher_role);

      setParseStatus("✓ Metadata extracted and form auto-filled!");
    } catch (err: any) {
      setError(`Failed to parse script: ${err.message}`);
      setParseStatus(null);
    } finally {
      setParsing(false);
    }
  };

  // Re-parse metadata if an API key is entered after file upload
  const handleApiKeyChange = async (
    key1: string,
    key2: string,
    key3: string,
    key4: string,
    key5: string,
    key6: string
  ) => {
    setGroqApiKey1(key1);
    setGroqApiKey2(key2);
    setGroqApiKey3(key3);
    setGroqApiKey4(key4);
    setGroqApiKey5(key5);
    setGroqApiKey6(key6);
    
    // If we have lesson content but fields are empty, try to parse
    const keys = uniqueGroqApiKeys([key1, key2, key3, key4, key5, key6]);
    if (keys.length > 0 && lessonContent && !subject && !topic) {
      setParsing(true);
      setParseStatus("Parsing metadata with AI...");
      try {
        const metadata = await (async () => {
          const errors: string[] = [];
          for (let i = 0; i < keys.length; i++) {
            setParseStatus(`Parsing metadata with AI using key ${i + 1}/${keys.length}...`);
            try {
              return await extractMetadataFromScript(keys[i], lessonContent);
            } catch (err: any) {
              errors.push(`Key ${i + 1}: ${err.message || String(err)}`);
              if (!isGroqLimitError(err) || i === keys.length - 1) {
                throw new Error(errors.join(" | "));
              }
            }
          }
          throw new Error("No Groq API keys were available.");
        })();
        if (metadata.subject) setSubject(metadata.subject);
        if (metadata.chapter) setChapter(metadata.chapter);
        if (metadata.topic) setTopic(metadata.topic);
        if (metadata.video_title) setVideoTitle(metadata.video_title);
        if (metadata.learning_objective) setLearningObjective(metadata.learning_objective);
        if (metadata.teacher_name) setTeacherName(metadata.teacher_name);
        if (metadata.teacher_role) setTeacherRole(metadata.teacher_role);
        setParseStatus("✓ Metadata extracted and form auto-filled!");
      } catch (err: any) {
        setParseStatus(`Could not parse metadata: ${err.message}`);
      } finally {
        setParsing(false);
      }
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      if (groqApiKeys.length === 0) throw new Error("Please enter your Groq API key.");
      if (!subject.trim()) throw new Error("Subject is required.");
      if (!topic.trim()) throw new Error("Topic is required.");
      if (!lessonContent.trim()) throw new Error("Please upload a lesson script file.");

      const teacherFiles = teacherVideoRef.current?.files;
      if (!teacherFiles?.length) throw new Error("Please upload a teacher video.");

      uploadedImages.forEach((file, index) => {
        if (!(file as any).assetName) {
          const ext = imageExtension(file.name, file.type || "");
          (file as any).assetName = `Uploaded_Image_${String(index + 1).padStart(2, "0")}.${ext}`;
        }
      });

      // Use the original URL if available so the LLM maps it directly.
      const imageNames = uploadedImages.map((f) => (f as any).originalUrl || f.name);

      const voiceoverFiles = voiceoverRef.current?.files;
      const hasVoiceover = !!(voiceoverFiles && voiceoverFiles.length > 0);
      const voiceoverName = hasVoiceover ? voiceoverFiles![0].name : null;
      const teacherVideoName = teacherFiles[0].name;

      const meta: FormMeta = {
        subject,
        chapter,
        topic,
        video_title: videoTitle || `${topic} - Video Lesson`,
        learning_objective: learningObjective,
        teacher_name: teacherName,
        teacher_role: teacherRole,
      };

      const plan = await runWithGroqKeyFallback(
        "Scene plan generation",
        (apiKey) => groqGeneratePlan(
          apiKey,
          meta,
          lessonContent,
          imageNames,
          hasVoiceover,
          fixedNames
        )
      );

      const imageAliases: Record<string, string> = {};
      uploadedImages.forEach((file) => {
        const assetName = (file as any).assetName || file.name;
        imageAliases[normalizeSourceUrl((file as any).originalUrl || file.name)] = assetName;
        imageAliases[file.name] = assetName;
      });

      // Replace source URLs with stable packaged filenames. A single image may
      // be reused by multiple scenes, so its ZIP filename must never change.
      if (plan.scenes) {
        plan.scenes.forEach((scene) => {
          if (scene.image_files) {
            scene.image_files = scene.image_files.map(
              (imgName) => imageAliases[normalizeSourceUrl(imgName)] || imageAliases[imgName] || imgName
            );
          }
        });
      }

      const mappedImageNames = uploadedImages.map((f) => (f as any).assetName || f.name);

      const normalized = normalizePlan(
        plan,
        meta,
        teacherVideoName,
        mappedImageNames,
        voiceoverName,
        teacherVideoIsGreenScreen ? "green_screen" : "white_or_light",
        lessonContent,
        imageAliases
      );
      const jsxCode = generateJsx(normalized);

      const topicSlug = slugify(topic);
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const jobId = `${topicSlug}_${stamp}`;

      setResult({ manifest: normalized, jsxCode, jobId });
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!result) return;
    setDownloading(true);
    try {
      const topicSlug = slugify(topic);
      const zip = new JSZip();
      const masterCompName = result.manifest.ae.master_comp_name || `${topicSlug}_Auto_Master`;

      // Core files
      zip.file("lesson_manifest.json", JSON.stringify(result.manifest, null, 2));
      zip.file("lesson_generator.jsx", result.jsxCode);
      zip.file(`ae_run_${topicSlug}_generator.jsx`, generateRunnerJsx(topicSlug));
      zip.file("README.txt", generateReadme(topic, subject, topicSlug));

      // Verification scripts
      zip.file("ae_inspect_generated.jsx", generateInspectionJsx(masterCompName));
      zip.file("ae_export_qa_frames.jsx", generateQaFrameExportJsx(masterCompName));

      // User assets
      const assetsFolder = zip.folder("assets");
      if (assetsFolder) {
        const teacherFiles = teacherVideoRef.current?.files;
        if (teacherFiles?.length) {
          const buf = await teacherFiles[0].arrayBuffer();
          assetsFolder.file(teacherFiles[0].name, buf);
        }
        const voiceoverFiles = voiceoverRef.current?.files;
        if (voiceoverFiles?.length) {
          const buf = await voiceoverFiles[0].arrayBuffer();
          assetsFolder.file(voiceoverFiles[0].name, buf);
        }
        
        // Add auto-extracted images with their proper Scene-based names
        for (let i = 0; i < uploadedImages.length; i++) {
          const file = uploadedImages[i];
          const finalName = (file as any).assetName || file.name;
          const arrayBuffer = await file.arrayBuffer();
          assetsFolder.file(finalName, arrayBuffer);
        }
      }

      // Fixed assets — download from GitHub and include
      const fixedFolder = zip.folder("fixed_assets");
      if (fixedFolder) {
        const fixedFiles = getAllFixedFiles(subject);
        for (const ff of fixedFiles) {
          try {
            const resp = await fetch(ff.url);
            if (resp.ok) {
              const buf = await resp.arrayBuffer();
              fixedFolder.file(ff.filename, buf);
            }
          } catch {
            console.warn("Could not download fixed asset:", ff.filename);
          }
        }
      }

      // Template .aep — from user upload, goes to template/ folder
      const templateFolder = zip.folder("template");
      if (templateFolder) {
        const templateFiles = templateAepRef.current?.files;
        if (templateFiles?.length) {
          const buf = await templateFiles[0].arrayBuffer();
          // Always use the canonical name so the runner can find it
          templateFolder.file("Dental Formula (converted).aep", buf);
        }
      }

      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${result.jobId}.zip`);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.manifest, null, 2)], {
      type: "application/json",
    });
    saveAs(blob, "lesson_manifest.json");
  };

  // Compute total duration from scenes
  const totalDuration = result
    ? result.manifest.scenes.reduce((sum, s) => sum + s.duration, 0)
    : 0;

  // Determine which subjects are available
  const availableSubjects = Object.keys(SUBJECT_ASSETS);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,#0f172a)] text-gray-200 font-[Inter,system-ui,-apple-system,Segoe_UI,Roboto,Arial,sans-serif]">
      {/* Header */}
      <header className="px-6 pt-7 pb-2">
        <h1 className="text-[32px] font-bold m-0 mb-2">Edubee Lesson Platform</h1>
        <p className="text-gray-400 m-0 max-w-[960px]">
          Template-faithful After Effects video generation — Dental Formula architecture.
          Upload a lesson script and the system will auto-extract metadata, generate scene plans, and build JSX that duplicates the template "Pro" comp per scene.
        </p>
      </header>

      {/* Main Grid */}
      <main className="px-6 pt-4 pb-8 grid grid-cols-1 md:grid-cols-[minmax(340px,520px)_1fr] gap-[18px]">
        {/* ── Left Column: Form ──────────────────────────── */}
        <div className="bg-[rgba(17,24,39,0.86)] border border-white/[0.08] rounded-[20px] shadow-[0_12px_40px_rgba(0,0,0,0.28)] p-[18px]">
          <form onSubmit={handleGenerate}>
            {/* Groq API Keys — FIRST so we can parse */}
            <label className="block mt-1 mb-2 font-semibold">Groq API Key 1</label>
            <input
              type="password"
              value={groqApiKey1}
              onChange={(e) => handleApiKeyChange(e.target.value, groqApiKey2, groqApiKey3, groqApiKey4, groqApiKey5, groqApiKey6)}
              placeholder="gsk_key_1"
              className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]"
            />
            <label className="block mt-3 mb-2 font-semibold">Groq API Key 2 <span className="text-xs text-gray-500 font-normal">(fallback)</span></label>
            <input
              type="password"
              value={groqApiKey2}
              onChange={(e) => handleApiKeyChange(groqApiKey1, e.target.value, groqApiKey3, groqApiKey4, groqApiKey5, groqApiKey6)}
              placeholder="gsk_key_2"
              className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]"
            />
            <label className="block mt-3 mb-2 font-semibold">Groq API Key 3 <span className="text-xs text-gray-500 font-normal">(fallback)</span></label>
            <input
              type="password"
              value={groqApiKey3}
              onChange={(e) => handleApiKeyChange(groqApiKey1, groqApiKey2, e.target.value, groqApiKey4, groqApiKey5, groqApiKey6)}
              placeholder="gsk_key_3"
              className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]"
            />
            <label className="block mt-3 mb-2 font-semibold">Groq API Key 4 <span className="text-xs text-gray-500 font-normal">(fallback)</span></label>
            <input
              type="password"
              value={groqApiKey4}
              onChange={(e) => handleApiKeyChange(groqApiKey1, groqApiKey2, groqApiKey3, e.target.value, groqApiKey5, groqApiKey6)}
              placeholder="gsk_key_4"
              className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]"
            />
            <label className="block mt-3 mb-2 font-semibold">Groq API Key 5 <span className="text-xs text-gray-500 font-normal">(fallback)</span></label>
            <input
              type="password"
              value={groqApiKey5}
              onChange={(e) => handleApiKeyChange(groqApiKey1, groqApiKey2, groqApiKey3, groqApiKey4, e.target.value, groqApiKey6)}
              placeholder="gsk_key_5"
              className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]"
            />
            <label className="block mt-3 mb-2 font-semibold">Groq API Key 6 <span className="text-xs text-gray-500 font-normal">(fallback)</span></label>
            <input
              type="password"
              value={groqApiKey6}
              onChange={(e) => handleApiKeyChange(groqApiKey1, groqApiKey2, groqApiKey3, groqApiKey4, groqApiKey5, e.target.value)}
              placeholder="gsk_key_6"
              className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]"
            />
            <small className="text-gray-400 block mt-1.5">
              Key 1 is used first. If it hits TPM/rate limit, the app retries the same task with Key 2, then Key 3, Key 4, Key 5, and Key 6.
            </small>

            {/* Lesson Script File — PRIMARY INPUT */}
            <label className="block mt-5 mb-2 font-semibold text-blue-300">
              📄 Lesson Script File <span className="text-xs text-gray-500 font-normal">(PDF, DOCX, or TXT)</span>
            </label>
            <input
              type="file"
              ref={scriptFileRef}
              accept=".txt,.md,.docx,.pdf"
              required
              onChange={handleScriptUpload}
              className="w-full rounded-[14px] border border-blue-500/30 bg-blue-500/5 text-gray-200 px-3.5 py-3 font-[inherit] file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500/20 file:text-blue-300 hover:file:bg-blue-500/30"
            />
            {parsing && (
              <div className="flex items-center gap-2 mt-2 text-sm text-blue-300">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {parseStatus}
              </div>
            )}
            {!parsing && parseStatus && (
              <small className={`block mt-1.5 ${parseStatus.startsWith("✓") ? "text-emerald-400" : "text-amber-400"}`}>
                {parseStatus}
              </small>
            )}
            {lessonContent && (
              <small className="block mt-1.5 text-gray-500">
                📝 {lessonContent.length.toLocaleString()} characters extracted
              </small>
            )}

            {/* Divider */}
            <div className="border-t border-white/[0.08] my-5 pt-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-bold">Auto-Extracted Metadata</span>
              <span className="text-xs text-gray-600 ml-2">(edit if needed)</span>
            </div>

            {/* Subject */}
            <label className="block mt-3.5 mb-2 font-semibold">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              placeholder="e.g. Biology, Chemistry"
              className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]"
            />
            {subject.trim() && (
              <small className="block mt-1.5">
                {availableSubjects.some((s) => subject.toLowerCase().includes(s)) ? (
                  <span className="text-emerald-400">
                    ✓ Fixed assets matched: <strong>{availableSubjects.find((s) => subject.toLowerCase().includes(s))}</strong>
                  </span>
                ) : (
                  <span className="text-amber-400">
                    ⚠ No subject-specific assets. Supported: {availableSubjects.join(", ")}
                  </span>
                )}
              </small>
            )}

            {/* Chapter */}
            <label className="block mt-3.5 mb-2 font-semibold">Chapter</label>
            <input type="text" value={chapter} onChange={(e) => setChapter(e.target.value)} className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]" placeholder="e.g. Chapter 5: Cell Division" />

            {/* Topic */}
            <label className="block mt-3.5 mb-2 font-semibold">Topic</label>
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} required className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]" placeholder="e.g. Mitosis and Meiosis" />

            {/* Video Title */}
            <label className="block mt-3.5 mb-2 font-semibold">Video Title</label>
            <input type="text" value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]" placeholder="e.g. Understanding Cell Division" />

            {/* Learning Objective */}
            <label className="block mt-3.5 mb-2 font-semibold">Learning Objective</label>
            <textarea value={learningObjective} onChange={(e) => setLearningObjective(e.target.value)} className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit] min-h-[80px] resize-y" placeholder="Students will learn to..." />

            {/* Teacher Name */}
            <label className="block mt-3.5 mb-2 font-semibold">Teacher Name</label>
            <input type="text" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]" placeholder="e.g. Dr. Jane Smith" />

            {/* Teacher Role */}
            <label className="block mt-3.5 mb-2 font-semibold">Teacher Role</label>
            <input type="text" value={teacherRole} onChange={(e) => setTeacherRole(e.target.value)} className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit]" placeholder="e.g. Professor, Teacher" />

            {/* Divider */}
            <div className="border-t border-white/[0.08] my-5 pt-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-bold">Media Assets</span>
            </div>

            {/* Template .aep */}
            <label className="block mt-3.5 mb-2 font-semibold text-emerald-300">
              🎬 Template .aep File <span className="text-xs text-gray-500 font-normal">(Dental Formula project)</span>
            </label>
            <input type="file" ref={templateAepRef} accept=".aep" required className="w-full rounded-[14px] border border-emerald-500/30 bg-emerald-500/5 text-gray-200 px-3.5 py-3 font-[inherit] file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/20 file:text-emerald-300 hover:file:bg-emerald-500/30" />
            <small className="text-gray-400 block mt-1.5">Upload the Dental Formula .aep template containing the "Pro" comp.</small>

            {/* Teacher Video */}
            <label className="block mt-3.5 mb-2 font-semibold">Teacher Video</label>
            <input type="file" ref={teacherVideoRef} accept=".mp4,.mov,.m4v,.webm" required className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit] file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500/20 file:text-blue-300 hover:file:bg-blue-500/30" />
            <label className="flex items-start gap-2 mt-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={teacherVideoIsGreenScreen}
                onChange={(e) => setTeacherVideoIsGreenScreen(e.target.checked)}
                className="mt-1"
              />
              <span>
                This teacher video is green-screen. Use this for green-background footage so the generator uses gentler green-screen keying instead of the light/white-background method.
              </span>
            </label>

            {/* Voiceover */}
            <label className="block mt-3.5 mb-2 font-semibold">Voiceover (optional)</label>
            <input type="file" ref={voiceoverRef} accept=".mp3,.wav,.m4a" className="w-full rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-gray-200 px-3.5 py-3 font-[inherit] file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500/20 file:text-blue-300 hover:file:bg-blue-500/30" />

            {/* Auto-extracted images indicator */}
            {uploadedImages.length > 0 && (
              <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <div className="text-sm font-semibold text-emerald-400 mb-1.5">📷 Auto-Extracted Images ({uploadedImages.length})</div>
                <div className="flex gap-1.5 flex-wrap">
                  {uploadedImages.map((f, i) => (
                    <span key={i} className="bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded text-[11px] border border-emerald-500/20">{(f as any).assetName || f.name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Fixed assets preview panel */}
            <div className="mt-5 p-3.5 bg-black/25 border border-white/[0.06] rounded-2xl">
              <h3 className="text-sm font-bold text-blue-300 mb-2.5 flex items-center gap-2">
                <span className="text-base">📦</span> Template Assets
                <span className="text-[10px] px-2 py-0.5 bg-blue-500/15 text-blue-300 rounded-full font-bold uppercase tracking-wider">Auto-included</span>
              </h3>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-4 text-center">🎬</span>
                  <span className="text-emerald-400">{COMMON_ASSETS.template_aep.filename}</span>
                  <span className="text-gray-600 ml-auto">Template</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 text-center">🏷</span>
                  <span className="text-gray-400">{COMMON_ASSETS.logo_transparent.filename}</span>
                  <span className="text-gray-600 ml-auto">Logo</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 text-center">📋</span>
                  <span className="text-gray-400">{COMMON_ASSETS.clipboard.filename}</span>
                  <span className="text-gray-600 ml-auto">Board</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 text-center">🔊</span>
                  <span className="text-gray-400">{COMMON_ASSETS.audio_jingle.filename}</span>
                  <span className="text-gray-600 ml-auto">Jingle</span>
                </div>
                <div className="border-t border-white/[0.06] pt-1.5 mt-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-4 text-center">🖼</span>
                    <span className={subjectAssets.background.filename !== COMMON_ASSETS.default_bg.filename ? "text-emerald-400" : "text-gray-400"}>
                      {subjectAssets.background.filename}
                    </span>
                    <span className="text-gray-600 ml-auto">BG</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 text-center">🎥</span>
                    <span className={subjectAssets.intro_video.filename ? "text-emerald-400" : "text-amber-400"}>
                      {subjectAssets.intro_video.filename || "(no intro)"}
                    </span>
                    <span className="text-gray-600 ml-auto">Intro</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !lessonContent}
              className="w-full rounded-[14px] border-none bg-gradient-to-br from-blue-500 to-violet-500 text-white font-bold px-3.5 py-3 mt-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-400 hover:to-violet-400 transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating with Groq AI…
                </span>
              ) : (
                "Generate Lesson Package"
              )}
            </button>
          </form>
        </div>

        {/* ── Right Column: Output ───────────────────────── */}
        <div className="bg-[rgba(17,24,39,0.86)] border border-white/[0.08] rounded-[20px] shadow-[0_12px_40px_rgba(0,0,0,0.28)] p-[18px]">
          {error && (
            <>
              <span className="inline-block px-2.5 py-1.5 rounded-full bg-red-500/15 text-red-300 text-xs mb-2.5">Error</span>
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3.5 text-red-300 mb-4">{error}</div>
            </>
          )}

          {result ? (
            <>
              <span className="inline-block px-2.5 py-1.5 rounded-full bg-[rgba(96,165,250,0.15)] text-blue-200 text-xs mb-2.5">Generated — Dental Formula Template</span>

              <div className="flex gap-3 mb-4">
                <button
                  onClick={handleDownloadZip}
                  disabled={downloading}
                  className="rounded-[14px] border-none bg-gradient-to-br from-blue-500 to-violet-500 text-white font-bold px-5 py-2.5 cursor-pointer hover:from-blue-400 hover:to-violet-400 transition-all disabled:opacity-50"
                >
                  {downloading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Downloading assets…
                    </span>
                  ) : (
                    "📦 Download ZIP"
                  )}
                </button>
                <button
                  onClick={handleDownloadJson}
                  className="rounded-[14px] border border-white/[0.12] bg-white/[0.04] text-blue-200 font-bold px-5 py-2.5 cursor-pointer hover:bg-white/[0.08] transition-all"
                >
                  📄 View JSON
                </button>
              </div>

              {/* Build Summary */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-3 mb-4">
                <h3 className="text-sm font-bold text-emerald-400 mb-2">🎬 Build Summary</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-gray-500">Subject:</span> <span className="text-gray-300">{result.manifest.subject}</span></div>
                  <div><span className="text-gray-500">Topic:</span> <span className="text-gray-300">{result.manifest.topic}</span></div>
                  <div><span className="text-gray-500">Teacher:</span> <span className="text-gray-300">{result.manifest.teacher.name || "(not specified)"}</span></div>
                  <div><span className="text-gray-500">Scenes:</span> <span className="text-gray-300">{result.manifest.scenes.length}</span></div>
                  <div><span className="text-gray-500">Duration:</span> <span className="text-gray-300">{totalDuration.toFixed(2)}s</span></div>
                  <div><span className="text-gray-500">Architecture:</span> <span className="text-emerald-400">Template Sub-Comp</span></div>
                </div>
              </div>

              {/* Segment Timings Reference */}
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-3 mb-4">
                <h3 className="text-sm font-bold text-violet-400 mb-2">⏱ Template Segment Timings</h3>
                <div className="grid grid-cols-4 gap-1.5 text-xs">
                  {Object.entries(SEGMENTS).map(([key, seg]) => (
                    <div key={key} className="bg-black/20 rounded-lg p-1.5 text-center">
                      <div className={`font-bold text-[10px] uppercase ${sceneTypeBadgeClass(key).replace(/bg-\S+/, "").trim()}`}>{key}</div>
                      <div className="text-gray-300 font-mono text-[11px]">{seg.playDuration}s</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scene Plan */}
              <h3 className="text-lg font-bold mb-3 text-blue-300">Scene Plan</h3>

              {/* Intro comp indicator */}
              {subjectAssets.intro_video.filename && (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-3 mb-2 flex items-center gap-3">
                  <span className="inline-block px-2 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300">intro</span>
                  <div>
                    <div className="font-semibold text-sm text-purple-200">Subject Intro Video</div>
                    <div className="text-xs text-gray-500">{subjectAssets.intro_video.filename}</div>
                  </div>
                </div>
              )}

              <div className="grid gap-2 mb-4">
                {result.manifest.scenes.map((scene) => (
                  <div key={scene.id} className="bg-black/35 border border-white/[0.08] rounded-2xl p-3.5 flex gap-3 items-start">
                    <span className={`inline-block px-2 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${sceneTypeBadgeClass(scene.type)}`}>
                      {scene.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{scene.id}: {scene.title}</div>
                      
                      <div className="mt-2 space-y-2 text-xs border border-white/10 bg-black/40 rounded-lg p-2.5">
                        {scene.header && (
                          <div><span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Header:</span> <span className="text-gray-300 ml-1">{scene.header}</span></div>
                        )}
                        {(scene.body || (scene.body_steps && scene.body_steps.length > 0)) && (
                          <div>
                            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Body Text:</span> 
                            <div className="text-gray-300 mt-1 whitespace-pre-wrap leading-relaxed">{scene.body}</div>
                            {scene.body_steps?.map((step, i) => <div key={i} className="text-gray-400 ml-2 mt-0.5">• {step.text}</div>)}
                          </div>
                        )}
                        {scene.subtitles && scene.subtitles.length > 0 && (
                          <div className="pt-1">
                            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Audio Cues (Subtitles):</span>
                            <div className="pl-2 border-l border-gray-700 mt-1 space-y-1">
                              {scene.subtitles.map((sub, i) => (
                                <div key={i} className="text-gray-400 italic leading-relaxed">"{sub.text}"</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {scene.image_files && scene.image_files.length > 0 && (
                          <div className="pt-1">
                            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Images:</span>
                            <div className="flex gap-2 mt-1.5 flex-wrap">
                              {scene.image_files.map((img, i) => (
                                <span key={i} className="bg-blue-500/15 text-blue-300 px-2 py-1 rounded text-[11px] border border-blue-500/20">{img}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-3 mt-2.5 text-[11px] text-gray-500 font-medium">
                        <span className="bg-black/30 px-2 py-0.5 rounded">⏱ {scene.duration}s</span>
                        {scene.lower_third_main && <span className="bg-black/30 px-2 py-0.5 rounded">🎤 {scene.lower_third_main}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Verification Instructions */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3 mb-4">
                <h3 className="text-sm font-bold text-amber-400 mb-2">🔍 Verification Scripts Included</h3>
                <div className="space-y-1.5 text-xs text-gray-400">
                  <div><code className="text-amber-300">ae_inspect_generated.jsx</code> — Run after building to generate a <code>verification_report.txt</code> with layer counts, positions, text content, and effects.</div>
                  <div><code className="text-amber-300">ae_export_qa_frames.jsx</code> — Exports PNG frames at each scene midpoint for visual QA comparison.</div>
                </div>
              </div>

              {/* ZIP Structure */}
              <h3 className="text-lg font-bold mb-3 mt-4 text-blue-300">📁 ZIP Structure</h3>
              <pre className="overflow-auto bg-black/35 border border-white/[0.08] rounded-2xl p-3.5 whitespace-pre-wrap text-xs text-gray-300">
{`${result.jobId}/
├── template/
│   └── ${COMMON_ASSETS.template_aep.filename}
├── lesson_manifest.json
├── lesson_generator.jsx
├── ae_run_${slugify(topic)}_generator.jsx
├── ae_inspect_generated.jsx
├── ae_export_qa_frames.jsx
├── README.txt
├── assets/
│   └── (your uploaded files)
└── fixed_assets/
    └── (template files for ${subject || "this subject"})`}
              </pre>

              {/* Manifest JSON */}
              <h3 className="text-lg font-bold mb-3 mt-4 text-blue-300">Manifest JSON</h3>
              <pre className="overflow-auto bg-black/35 border border-white/[0.08] rounded-2xl p-3.5 whitespace-pre-wrap break-words text-xs text-gray-300 max-h-[400px]">
                {JSON.stringify(result.manifest, null, 2)}
              </pre>

              {/* JSX Preview */}
              <h3 className="text-lg font-bold mb-3 mt-4 text-blue-300">Generated JSX (preview)</h3>
              <pre className="overflow-auto bg-black/35 border border-white/[0.08] rounded-2xl p-3.5 whitespace-pre-wrap break-words text-xs text-gray-300 max-h-[300px]">
                {result.jsxCode.slice(0, 3000)}...
              </pre>
            </>
          ) : (
            <>
              <span className="inline-block px-2.5 py-1.5 rounded-full bg-[rgba(96,165,250,0.15)] text-blue-200 text-xs mb-2.5">Ready</span>
              <p className="text-gray-400 mb-4">Upload a lesson script to auto-extract metadata and generate your video package.</p>

              {/* Architecture info */}
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-4 mb-4">
                <h3 className="text-base font-bold text-violet-300 mb-3">🏗 Dental Formula Architecture</h3>
                <div className="space-y-2 text-sm text-gray-400">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Duplicates the "Pro" template comp per scene — preserving all built-in animations</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Configures layers by index — clipboard, teacher, images, text</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Creates helper comps — timed sequences, pair boards, image layouts</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Assembles master comp from scene sub-comps with precise segment timings</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Adds timed subtitles with line-split measurement</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Includes verification scripts for QA inspection</span>
                  </div>
                </div>
              </div>

              {/* Workflow */}
              <div className="bg-black/20 border border-white/[0.05] rounded-2xl p-4 mb-4">
                <h3 className="text-base font-bold text-blue-300 mb-3">📋 Workflow</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-400">
                  <li><strong className="text-gray-300">Enter your Groq API key</strong> (needed for AI extraction)</li>
                  <li><strong className="text-blue-300">Upload your lesson script</strong> (PDF or DOCX)</li>
                  <li>The system will <strong className="text-emerald-400">auto-extract</strong>: Subject, Chapter, Topic, Title, Teacher Name, etc.</li>
                  <li>Review and edit the extracted metadata if needed</li>
                  <li>Upload teacher video and images</li>
                  <li>Click <strong>Generate</strong> to create the After Effects package</li>
                  <li>In AE: run <code className="text-violet-300">ae_run_*_generator.jsx</code> — opens template + builds all scenes</li>
                  <li>Run <code className="text-amber-300">ae_inspect_generated.jsx</code> to verify the output</li>
                </ol>
              </div>

              {/* Scene Types Reference */}
              <div className="bg-black/20 border border-white/[0.05] rounded-2xl p-4 mb-4">
                <h3 className="text-base font-bold text-emerald-400 mb-3">🎬 Scene Types</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { type: "title", desc: "Title card with topic/subject (6.36s)" },
                    { type: "center", desc: "Teacher intro, no clipboard (5.60s)" },
                    { type: "pair", desc: "Two-image comparison board (8.60s)" },
                    { type: "single", desc: "Single image on clipboard (7.20s)" },
                    { type: "triple", desc: "Timed image sequence (12.60s)" },
                    { type: "summary", desc: "Summary overview board (12.60s)" },
                    { type: "outro", desc: "Closing card with jingle (2.44s)" },
                  ].map((item) => (
                    <div key={item.type} className="flex items-center gap-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${sceneTypeBadgeClass(item.type)}`}>{item.type}</span>
                      <span className="text-gray-400">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fixed Assets Reference */}
              <div className="bg-black/20 border border-white/[0.05] rounded-2xl p-4">
                <h3 className="text-base font-bold text-emerald-400 mb-3">📦 Subject-Specific Assets</h3>
                <p className="text-xs text-gray-500 mb-3">Based on the extracted subject, these template files are auto-included:</p>
                {Object.entries(SUBJECT_ASSETS).map(([subj, assets]) => (
                  <div key={subj} className="mb-2">
                    <div className="text-xs font-bold text-blue-300 capitalize mb-1">{subj}</div>
                    <div className="space-y-0.5 text-xs ml-4 text-gray-400">
                      <div>🖼 {assets.background.filename}</div>
                      <div>🎥 {assets.intro_video.filename}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
