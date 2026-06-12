const fs = require("fs");
const vm = require("vm");
const ts = require("typescript");
const acorn = require("acorn");
const path = require("path");
const { execFileSync } = require("child_process");

function loadTsModule(path, requireMap = {}) {
  const source = fs.readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(requireMap, id)) return requireMap[id];
    return require(id);
  };
  vm.runInNewContext(
    `(function (exports, require, module) { ${output}\n})`,
    {},
    { filename: path }
  )(module.exports, localRequire, module);
  return module.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const parseScript = loadTsModule("src/lib/parseScript.ts", {
  "pdfjs-dist": { GlobalWorkerOptions: {} },
  mammoth: {},
});

const extractedText = execFileSync(process.execPath, [path.join("tests", "test_extract.cjs")], {
  encoding: "utf8",
});
const extractedScenes = parseScript.extractStructuredScriptScenes(extractedText);

assert(extractedScenes.length === 9, `Expected 9 source scenes, got ${extractedScenes.length}`);
assert(extractedScenes[5].header === "Process of Photosynthesis", "Process header was not preserved");
assert(extractedScenes[5].imageUrls.length === 4, "Process images were not fully extracted");
assert(extractedScenes[7].imageUrls.length === 5, "Role of Glucose images were not fully extracted");

const sceneSchema = loadTsModule("src/lib/sceneSchema.ts");
const fixedAssets = loadTsModule("src/lib/fixedAssets.ts");
const normalizePlan = loadTsModule("src/lib/normalizePlan.ts", {
  "./sceneSchema": sceneSchema,
  "./fixedAssets": fixedAssets,
  "./parseScript": parseScript,
});

const allUrls = parseScript.extractImageUrls(extractedText);
const imageAliases = {};
const imageNames = allUrls.map((url, index) => {
  const name = `Script_Image_${String(index + 1).padStart(2, "0")}.jpg`;
  imageAliases[url] = name;
  return name;
});

const manifest = normalizePlan.normalizePlan(
  {},
  {
    subject: "Biology",
    chapter: "Nutrition in Plants",
    topic: "Photosynthesis",
    video_title: "Photosynthesis and Its Process",
    learning_objective: "Meaning and equation of photosynthesis",
    teacher_name: "Teacher",
    teacher_role: "Biology Teacher",
  },
  "teacher.mov",
  imageNames,
  "voiceover.mp3",
  "white_or_light",
  extractedText,
  imageAliases
);

const dirtyManifest = normalizePlan.normalizePlan(
  {
    scenes: [
      {
        id: "dirty_scene",
        type: "single",
        duration: 7.2,
        title: "TEXT ON SCREEN: Clean Title",
        header: "TEXT ON SCREEN: Clean Header",
        body: "TEXT ON SCREEN: Clean body\nProduction notes: do not render this\nVISUALIZATION: show a plant image",
        narration: "Audio/animation cues: Clean narration\n0:00-0:03 Fade in the board",
        visual_cues: "",
        image_files: [],
        on_screen_text: "TEXT ON SCREEN: Clean Header",
        layout_note: "",
        subtitles: [
          { start: 0, end: 2, text: "Audio/animation cues: Clean subtitle" },
          { start: 2, end: 3, text: "VISUALIZATION: do not render" },
        ],
      },
    ],
  },
  {
    subject: "Biology",
    chapter: "Test",
    topic: "Photosynthesis",
    video_title: "Photosynthesis",
    learning_objective: "Test objective",
    teacher_name: "Teacher",
    teacher_role: "Biology Teacher",
  },
  "teacher.mov",
  [],
  null,
  "white_or_light",
  "",
  {}
);

const dirtyScene = dirtyManifest.scenes[0];
assert(dirtyScene.header === "Clean Header", "Production label was not stripped from header");
assert(dirtyScene.body === "Clean body", `Production notes leaked into body: ${dirtyScene.body}`);
assert(dirtyScene.narration === "Clean narration", `Production cue leaked into narration: ${dirtyScene.narration}`);
assert(
  dirtyScene.subtitles?.length === 1 && dirtyScene.subtitles[0].text === "Clean subtitle",
  "Production note subtitle was not removed"
);

assert(manifest.scenes.length === 10, `Expected 9 source scenes plus outro, got ${manifest.scenes.length}`);
assert(manifest.scenes[0].type === "title", "First scene is not the source title");
assert(manifest.scenes[manifest.scenes.length - 1].type === "outro", "Outro was not appended");
assert(
  manifest.scenes.some((scene) => scene.header === "Role of Each Requirement"),
  `A source header was dropped: ${manifest.scenes.map((scene) => scene.header).join(" | ")}`
);
assert(
  manifest.scenes.some((scene) => scene.body.includes("Chlorophyll is a green pigment")),
  "A source body paragraph was dropped"
);
assert(
  manifest.scenes.flatMap((scene) => scene.subtitles || []).some((block) =>
    block.text.toLowerCase().includes("cellulose")
  ),
  "A source audio cue was dropped"
);
assert(
  manifest.scenes.reduce((count, scene) => count + scene.image_files.length, 0) >= 20,
  "Source image references were not assigned to scenes"
);

const generateJsx = loadTsModule("src/lib/generateJsx.ts");
const jsx = generateJsx.generateJsx(manifest);
acorn.parse(jsx, { ecmaVersion: 2020 });

assert(jsx.includes("resetBoardTemplate"), "Generated JSX lacks template cleanup");
assert(jsx.includes("Teacher_Full_Frame"), "Generated JSX lacks the keyed teacher comp");
assert(jsx.includes("One continuous keyed teacher layer"), "Generated JSX lacks the smooth teacher transition");
assert(jsx.includes("var BOARD_TEACHER_POSITION = [352, 722, 0]"), "Teacher lower-left position drifted from the reference");
assert(jsx.includes("var BOARD_TEACHER_SCALE = [105, 105, 100]"), "Teacher lower-left scale drifted from the reference");
assert(
  jsx.includes('return type === "single" || type === "triple" || type === "summary";'),
  "Pair scenes should not be treated as clipboard board scenes"
);
assert(jsx.includes("The clipboard is revealed exactly once"), "Generated JSX lacks the one-time board reveal guard");
assert(jsx.includes("voiceoverItem"), "Generated JSX lacks voiceover import");
assert(!jsx.includes("segment.start + 3600"), "Generated JSX still extends every old template layer");

console.log(
  `Pipeline verification passed: ${extractedScenes.length} source scenes, ` +
  `${manifest.scenes.length} output scenes, ${allUrls.length} image URLs.`
);
