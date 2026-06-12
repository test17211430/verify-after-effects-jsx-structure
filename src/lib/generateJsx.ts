import type { LessonManifest } from "./sceneSchema";

/**
 * Generates the After Effects JSX script that follows the Dental Formula
 * template pattern. This script:
 *
 * 1. Opens the template .aep (Dental Formula) project
 * 2. Finds the "Pro" template comp
 * 3. Duplicates it for each scene
 * 4. Configures layers per scene type (title, center, pair, single, triple, summary, outro)
 * 5. Creates helper comps for image layouts
 * 6. Builds a master comp from scene sub-comps
 * 7. Adds timed subtitles
 */
export function generateJsx(plan: LessonManifest): string {
  const manifestJson = JSON.stringify(plan, null, 2);

  const jsx = `(function () {
  var MANIFEST = __MANIFEST__;

  var SCRIPT_NAME = "Edubee Lesson Generator";
  var MASTER_COMP_NAME = MANIFEST.ae.master_comp_name || "Lesson_Auto_Master";
  var TEMPLATE_COMP_NAME = "Pro";
  var GENERATED_PREFIX = "GEN_";

  var scriptFile = new File($.fileName);
  var rootFolder = scriptFile.parent;
  var assetsFolder = new Folder(rootFolder.fsName + "/assets");
  var fixedFolder  = new Folder(rootFolder.fsName + "/fixed_assets");
  var templateFolder = new Folder(rootFolder.fsName + "/template");

  // ── Segment timings from the template comp ──
  var SEGMENTS = {
    title:  { start: 0.00,  duration: 6.36,  playDuration: 6.36  },
    outro:  { start: 0.00,  duration: 2.44,  playDuration: 2.44  },
    pair:   { start: 6.36,  duration: 11.92, playDuration: 8.60  },
    center: { start: 18.28, duration: 7.44,  playDuration: 5.60  },
    single: { start: 25.76, duration: 7.48,  playDuration: 7.20  },
    triple: { start: 33.24, duration: 25.16, playDuration: 12.60 }
  };

  // ── Layout constants ──
  var PAIR_CLIPBOARD_POSITION = [1353.969, 493.992, 0];
  var PAIR_CLIPBOARD_SCALE = [119, 119, 100];
  var BOARD_TEACHER_POSITION = [352, 722, 0];
  var BOARD_TEACHER_SCALE = [105, 105, 100];
  // Single shared header anchor (topCenter) so every board scene's header sits
  // in exactly the same place with the same size. Bodies stay well below this.
  var BOARD_HEADER_POSITION = [1274, 235, 0];
  var BOARD_HEADER_MAX_WIDTH = 940;
  var BOARD_IMAGE_POSITION = [1274, 522, 0];
  var BOARD_IMAGE_SCALE = 100;
  var PAIR_HEADER_POSITION = [1310, 214, 0];
  // Shared animation timing so the sequence stays in sync across every scene:
  // teacher does one quick move, THEN board + content fade in.
  var FADE_TIME = 0.4;          // standard fade-in duration (seconds)
  var TEACHER_MOVE_TIME = 0.24; // match Dental Formula's quick move duration
  var SINGLE_CANVAS = { width: 1264, height: 844 };
  var TRIPLE_CANVAS = { width: 1408, height: 768 };
  var HELPER_DURATION = 40;
  var SUBTITLE_FONT = "ArialMT";
  var SUBTITLE_FONT_SIZE = 22;
  var SUBTITLE_BAR_HEIGHT = 54;
  var SUBTITLE_SIDE_PADDING = 38;
  var SUBTITLE_BAR_OPACITY = 58;
  var BOARD_HEADER_FONT_SIZE = 50;

  // ── Logging ──
  function log(msg) { try { $.writeln("[AE] " + msg); } catch (_) {} }

  // ── Utility Functions ──
  function safeName(text) {
    return String(text).replace(/[^A-Za-z0-9_]+/g, "_");
  }

  function sanitizeVisibleText(value) {
    var lines = String(value || "").split(/\\r\\n|\\r|\\n/);
    var cleanLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      line = line.replace(/\\b\\d{1,2}\\s*:\\s*\\d{2}\\s*[\\u2013\\u2014-]\\s*\\d{1,2}\\s*:\\s*\\d{2}\\b/g, " ");
      line = line.replace(/\\b\\d{1,2}\\s*:\\s*\\d{2}\\b/g, " ");

      if (/^\\s*(?:visuali[sz]ation|visual\\s*\\/?\\s*animation instructions?|production notes?|editor(?:'|\\u2019)?s? notes?|scene timing|timestamp references?|frame\\s*\\/?\\s*layout)\\b/i.test(line)) {
        continue;
      }

      line = line.replace(
        /^\\s*(?:text on screen|null screen header|screen header|body text|header|title text|audio\\s*\\/?\\s*animation cues?|audio cues?)\\s*:?\\s*/i,
        ""
      );
      line = line.replace(/\\b(?:text on screen|null screen header|screen header|body text|audio\\s*\\/?\\s*animation cues?)\\b\\s*:?/gi, " ");

      if (/^\\s*(?:fade|animate|move|slide|zoom|cut|transition|place|position|show|display)\\b/i.test(line)) {
        continue;
      }

      line = line.replace(/\\s{2,}/g, " ").replace(/^\\s+|\\s+$/g, "");
      if (line) cleanLines.push(line);
    }
    return cleanLines.join("\\r\\n");
  }

  function sanitizeTimedTextBlocks(blocks) {
    var cleanBlocks = [];
    blocks = blocks || [];
    for (var i = 0; i < blocks.length; i++) {
      var cleanText = sanitizeVisibleText(blocks[i].text);
      if (!cleanText) continue;
      cleanBlocks.push({
        start: blocks[i].start,
        end: blocks[i].end,
        text: cleanText
      });
    }
    return cleanBlocks;
  }

  function safeImport(filePath) {
    try {
      var f = new File(filePath);
      if (!f.exists) { log("SKIP: " + filePath); return null; }
      var io = new ImportOptions(f);
      if (!io.canImportAs(ImportAsType.FOOTAGE)) { log("SKIP type: " + filePath); return null; }
      return app.project.importFile(io);
    } catch (e) { log("ERR import: " + e.message); return null; }
  }

  function findCompByName(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem && item.name === name) return item;
    }
    return null;
  }

  function findProjectItemByName(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
      if (app.project.item(i).name === name) return app.project.item(i);
    }
    return null;
  }

  function findLayerByName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).name === name) return comp.layer(i);
    }
    return null;
  }

  function findLayerByRegex(comp, regex) {
    for (var i = 1; i <= comp.numLayers; i++) {
      try {
        var layer = comp.layer(i);
        if (layer && layer.name && regex.test(layer.name)) return layer;
      } catch (_) {}
    }
    return null;
  }

  function getLayer(comp, index) {
    if (index < 1 || index > comp.numLayers) return null;
    return comp.layer(index);
  }

  function setLayerEnabled(comp, index, enabled) {
    try { getLayer(comp, index).enabled = enabled; } catch (_) {}
  }

  function setLayerAudioEnabled(comp, index, enabled) {
    try { getLayer(comp, index).audioEnabled = enabled; } catch (_) {}
  }

  function disableLayers(comp, startIndex, endIndex) {
    for (var i = startIndex; i <= endIndex; i++) setLayerEnabled(comp, i, false);
  }

  function resetBoardTemplate(comp) {
    disableLayers(comp, 1, 38);
    setLayerEnabled(comp, 39, true); // Clipboard
    disableLayers(comp, 40, 44);
  }

  function resetCenterTemplate(comp) {
    disableLayers(comp, 1, 44);
  }

  // ── Property helpers (preserve existing keyframes) ──
  function setPropertyValuePreserveKeys(property, value) {
    if (!property) return;
    if (property.numKeys && property.numKeys > 0) {
      for (var i = 1; i <= property.numKeys; i++) property.setValueAtKey(i, value);
      return;
    }
    property.setValue(value);
  }

  function movePropertyToPositionPreserveKeys(property, targetValue) {
    if (!property) return;
    var target = targetValue.slice ? targetValue.slice(0) : targetValue;
    if (property.numKeys && property.numKeys > 0) {
      var current = property.keyValue(property.numKeys);
      var delta = [];
      for (var i = 0; i < current.length; i++) delta.push(target[i] - current[i]);
      for (var k = 1; k <= property.numKeys; k++) {
        var kv = property.keyValue(k);
        var shifted = [];
        for (var j = 0; j < kv.length; j++) shifted.push(kv[j] + delta[j]);
        property.setValueAtKey(k, shifted);
      }
      return;
    }
    property.setValue(target);
  }

  function squashLayerTransform(layer, positionValue, scaleValue) {
    if (!layer || !layer.transform) return;
    var pos = layer.transform.position;
    var scale = layer.transform.scale;
    var opacity = layer.transform.opacity;
    var rotation = layer.transform.rotation;
    try { while (pos.numKeys > 0) pos.removeKey(pos.numKeys); } catch (_) {}
    try { while (scale.numKeys > 0) scale.removeKey(scale.numKeys); } catch (_) {}
    try { while (opacity.numKeys > 0) opacity.removeKey(opacity.numKeys); } catch (_) {}
    try { while (rotation.numKeys > 0) rotation.removeKey(rotation.numKeys); } catch (_) {}
    pos.setValue(positionValue);
    scale.setValue(scaleValue);
    try { opacity.setValue(100); } catch (_) {}
    try { rotation.setValue(0); } catch (_) {}
  }

  // ── Text Layer Helpers ──
  function setTextDocumentPreserveKeys(textProp, doc) {
    if (textProp.numKeys && textProp.numKeys > 0) {
      for (var i = 1; i <= textProp.numKeys; i++) textProp.setValueAtKey(i, doc);
      return;
    }
    textProp.setValue(doc);
  }

  function setTextLayer(layer, text, options) {
    options = options || {};
    var textProp = layer.property("Source Text");
    if (!textProp) return;
    var doc = textProp.value;
    doc.text = text;
    if (options.font) doc.font = options.font;
    if (options.fontSize) doc.fontSize = options.fontSize;
    if (options.leading) doc.leading = options.leading;
    if (options.fillColor) { doc.applyFill = true; doc.fillColor = options.fillColor; }
    if (options.strokeColor) { doc.applyStroke = true; doc.strokeColor = options.strokeColor; doc.strokeWidth = options.strokeWidth || 1; }
    else if (options.removeStroke) { doc.applyStroke = false; }
    if (options.justification) doc.justification = options.justification;
    setTextDocumentPreserveKeys(textProp, doc);
    if ((options.maxWidth || options.maxHeight) && !options.lockSize) {
      fitTextLayer(layer, options.maxWidth, options.maxHeight, options.minFontSize || 20);
    }
  }

  function fitTextLayer(layer, maxWidth, maxHeight, minFontSize) {
    var textProp = layer.property("Source Text");
    if (!textProp) return;
    var doc = textProp.value;
    var currentSize = doc.fontSize;
    while (currentSize > minFontSize) {
      var rect = layer.sourceRectAtTime(0, false);
      if ((!maxWidth || rect.width <= maxWidth) && (!maxHeight || rect.height <= maxHeight)) return;
      currentSize -= 1;
      doc.fontSize = currentSize;
      setTextDocumentPreserveKeys(textProp, doc);
    }
  }

  function positionTextLayer(layer, x, y, anchorMode) {
    var rect = layer.sourceRectAtTime(layer.inPoint || 0, false);
    var ax = 0, ay = 0;
    if (anchorMode === "center") { ax = rect.left + rect.width / 2; ay = rect.top + rect.height / 2; }
    else if (anchorMode === "topCenter") { ax = rect.left + rect.width / 2; ay = rect.top; }
    else if (anchorMode === "topLeft") { ax = rect.left; ay = rect.top; }
    else if (anchorMode === "bottomCenter") { ax = rect.left + rect.width / 2; ay = rect.top + rect.height; }
    setPropertyValuePreserveKeys(layer.transform.anchorPoint, [ax, ay, 0]);
    setPropertyValuePreserveKeys(layer.transform.position, [x, y, 0]);
  }

  function setLayerTimeRange(layer, inPoint, outPoint) {
    try { layer.inPoint = inPoint; layer.outPoint = outPoint; } catch (_) {}
  }

  function setLayerScaleValue(layer, scaleValue) {
    if (!layer || !layer.transform || !layer.transform.scale) return;
    setPropertyValuePreserveKeys(layer.transform.scale, scaleValue || [100, 100, 100]);
  }

  function wrapTextPreservingWords(text, maxChars) {
    if (!text || text.length <= maxChars) return text;
    var rawLines = String(text).split(/\\r\\n|\\r|\\n/);
    var wrappedLines = [];
    for (var i = 0; i < rawLines.length; i++) {
      var words = rawLines[i].split(/\\s+/);
      var current = "";
      for (var j = 0; j < words.length; j++) {
        if (!words[j]) continue;
        var candidate = current ? current + " " + words[j] : words[j];
        if (candidate.length > maxChars && current) { wrappedLines.push(current); current = words[j]; }
        else { current = candidate; }
      }
      if (current) wrappedLines.push(current);
      if (!rawLines[i].length) wrappedLines.push("");
    }
    return wrappedLines.join("\\r\\n");
  }

  // ── Scene text layer generators ──
  function addSceneTextLayer(comp, text, x, y, maxWidth, maxHeight, inPoint, outPoint, options) {
    var layer = comp.layers.addText(text);
    layer.name = GENERATED_PREFIX + "Text_" + safeName(String(text).substr(0, 36));
    var textOptions = options || {};
    textOptions.maxWidth = maxWidth;
    textOptions.maxHeight = maxHeight;
    if (textOptions.lockSize === undefined) textOptions.lockSize = true;
    setTextLayer(layer, text, textOptions);
    setLayerTimeRange(layer, inPoint, outPoint);
    positionTextLayer(layer, x, y, options.anchorMode || "topLeft");
    return layer;
  }

  function addBoardBodyBoxLayer(comp, bodyPosition, bodyBox, text, inPoint, outPoint, styleOptions) {
    var wrapChars = bodyBox.wrapChars || Math.max(20, Math.round((bodyBox.width / (styleOptions.fontSize || 30)) * 1.75));
    var wrappedText = wrapTextPreservingWords(text, wrapChars);
    return addSceneTextLayer(
      comp, wrappedText,
      bodyPosition[0], bodyPosition[1],
      bodyBox.width, bodyBox.height,
      inPoint, outPoint,
      styleOptions
    );
  }

  // ── Effects ──
  function findEffectByMatchName(effectGroup, matchName) {
    if (!effectGroup) return null;
    for (var i = 1; i <= effectGroup.numProperties; i++) {
      if (effectGroup.property(i).matchName === matchName) return effectGroup.property(i);
    }
    return null;
  }

  function applyTeacherVideoTreatment(layer, backgroundMode) {
    if (!layer) return;
    layer.blendingMode = BlendingMode.NORMAL;
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) return;
    var mode = backgroundMode || "white_or_light";

    var keylight = findEffectByMatchName(effects, "Keylight 906");
    var hasKeylight = false;
    if (keylight) {
      try {
        hasKeylight = true;
        keylight.enabled = true;
        keylight.property("ADBE Keylight-0001").setValue([0, 1, 0]); // Key color green
        keylight.property("ADBE Keylight-0002").setValue(mode === "green_screen" ? 0.22 : 0.32);
        keylight.property("ADBE Keylight-0003").setValue(mode === "green_screen" ? 0.42 : 0.45);
      } catch (_) {}
    }

    function addColorKey(color, tolerance) {
      var colorKey = null;
      try {
        colorKey = effects.addProperty("ADBE Color Key");
      } catch (_) {
        colorKey = null;
      }
      if (colorKey) {
        try {
          colorKey.property("ADBE Color Key-0001").setValue(color);
          colorKey.property("ADBE Color Key-0002").setValue(tolerance);
          colorKey.property("ADBE Color Key-0003").setValue(1);
          colorKey.property("ADBE Color Key-0004").setValue(2);
        } catch (_) {}
      }
    }

    if (mode === "green_screen") {
      if (!hasKeylight) addColorKey([0, 1, 0], 18);
      return;
    }

    addColorKey([1, 1, 1], 35); // White-background teacher videos
  }

  // ── Template comp helpers ──
  function replaceLayerSourceKeepTiming(layer, newSource) {
    var originalIn = layer.inPoint;
    var originalOut = layer.outPoint;
    layer.replaceSource(newSource, false);
    layer.startTime = originalIn;
    layer.inPoint = originalIn;
    layer.outPoint = originalOut;
  }

  function replaceTemplateLayerOrAdd(comp, index, newSource, fallbackName) {
    var layer = getLayer(comp, index);
    try {
      if (layer && layer.source) {
        replaceLayerSourceKeepTiming(layer, newSource);
        return layer;
      }
    } catch (_) {}
    layer = comp.layers.add(newSource);
    layer.name = fallbackName || (GENERATED_PREFIX + "Content_" + index);
    return layer;
  }

  function disableLayerByRegex(comp, regex) {
    for (var i = 1; i <= comp.numLayers; i++) {
      try {
        var layer = comp.layer(i);
        if (layer && layer.name && regex.test(layer.name)) {
          layer.enabled = false;
        }
      } catch (_) {}
    }
  }

  function duplicateTemplateComp(templateComp, sceneName, parentFolder) {
    var dup = templateComp.duplicate();
    dup.name = GENERATED_PREFIX + sceneName;
    if (parentFolder) dup.parentFolder = parentFolder;
    return dup;
  }

  function ensureProjectFolder(name, parentFolder) {
    var existing = findProjectItemByName(name);
    if (existing && existing instanceof FolderItem) return existing;
    var f = app.project.items.addFolder(name);
    if (parentFolder) f.parentFolder = parentFolder;
    return f;
  }

  // ── Image helper comps ──
  function centerAnchor(sourceItem) { return [sourceItem.width / 2, sourceItem.height / 2, 0]; }

  function addFullFrameImage(comp, sourceItem, mode) {
    var layer = comp.layers.add(sourceItem);
    var r = mode === "fit"
      ? Math.min(comp.width / sourceItem.width, comp.height / sourceItem.height)
      : Math.max(comp.width / sourceItem.width, comp.height / sourceItem.height);
    layer.transform.anchorPoint.setValue(centerAnchor(sourceItem));
    layer.transform.position.setValue([comp.width / 2, comp.height / 2, 0]);
    layer.transform.scale.setValue([r * 100, r * 100, 100]);
    return layer;
  }

  function addCellImage(comp, sourceItem, left, top, width, height, mode) {
    var layer = comp.layers.add(sourceItem);
    var r = mode === "fill"
      ? Math.max(width / sourceItem.width, height / sourceItem.height)
      : Math.min(width / sourceItem.width, height / sourceItem.height);
    layer.transform.anchorPoint.setValue(centerAnchor(sourceItem));
    layer.transform.position.setValue([left + width / 2, top + height / 2, 0]);
    layer.transform.scale.setValue([r * 100, r * 100, 100]);
    return layer;
  }

  function keepLayerForDuration(layer, duration) {
    try { layer.inPoint = 0; layer.outPoint = duration; } catch (_) {}
  }

  function createHelperComp(name, width, height, parentFolder, duration) {
    var helperDuration = Math.max(duration || HELPER_DURATION, 1);
    var comp = app.project.items.addComp(name, width, height, 1, helperDuration, 25);
    if (parentFolder) comp.parentFolder = parentFolder;
    return comp;
  }

  function createSingleImageComp(name, width, height, sourceItem, parentFolder, mode, duration) {
    var helperDuration = Math.max(duration || HELPER_DURATION, 1);
    var comp = createHelperComp(name, width, height, parentFolder, helperDuration);
    var imageLayer = addFullFrameImage(comp, sourceItem, mode || "fill");
    keepLayerForDuration(imageLayer, helperDuration);
    return comp;
  }

  function boardImageSafeRect(sceneType, hasBodyText) {
    if (sceneType === "single") {
      if (hasBodyText) return { left: 330, top: 370, width: 604, height: 350 };
      return { left: 282, top: 315, width: 700, height: 430 };
    }
    if (sceneType === "summary") {
      if (hasBodyText) return { left: 404, top: 365, width: 600, height: 335 };
      return { left: 354, top: 320, width: 700, height: 400 };
    }
    if (hasBodyText) return { left: 404, top: 365, width: 600, height: 335 };
    return { left: 354, top: 320, width: 700, height: 400 };
  }

  function createTimedSequenceComp(name, width, height, stages, parentFolder, duration) {
    var comp = createHelperComp(name, width, height, parentFolder, duration);
    for (var i = 0; i < stages.length; i++) {
      var stage = stages[i];
      var imageLayer;
      if (stage.rect) {
        imageLayer = addCellImage(comp, stage.source, stage.rect.left, stage.rect.top, stage.rect.width, stage.rect.height, stage.mode || "fit");
      } else {
        imageLayer = addFullFrameImage(comp, stage.source, stage.mode || "fit");
      }
      setLayerTimeRange(imageLayer, stage.start, stage.end);
    }
    return comp;
  }

  function placeBoardImageLayer(layer, canvasWidth, canvasHeight) {
    if (!layer || !layer.transform) return;
    try { layer.transform.anchorPoint.setValue([canvasWidth / 2, canvasHeight / 2, 0]); } catch (_) {}
    try {
      squashLayerTransform(
        layer,
        BOARD_IMAGE_POSITION,
        [BOARD_IMAGE_SCALE, BOARD_IMAGE_SCALE, 100]
      );
    } catch (_) {}
  }

  function createPreviousPairBoardComp(name, leftSource, rightSource, parentFolder, duration) {
    var w = SINGLE_CANVAS.width, h = SINGLE_CANVAS.height;
    var marginLeft = 163, marginRight = 136, gap = 42;
    var marginTop = 299, marginBottom = 230;
    var usableW = w - marginLeft - marginRight;
    var boxW = Math.max(360, Math.floor((usableW - gap) / 2));
    var boxH = h - marginTop - marginBottom;
    var comp = createHelperComp(name, w, h, parentFolder, duration);
    addCellImage(comp, leftSource, marginLeft, marginTop, boxW, boxH, "fit");
    addCellImage(comp, rightSource, marginLeft + boxW + gap, marginTop, boxW, boxH, "fit");
    return comp;
  }

  function extendFootageLayer(layer, duration) {
    if (!layer) return;
    try {
      layer.inPoint = 0;
      layer.outPoint = duration;
      if (layer.source && layer.source.duration > 0 && layer.source.duration < duration && layer.canSetTimeRemapEnabled) {
        layer.timeRemapEnabled = true;
        layer.property("Time Remap").expression = "loopOut('cycle')";
      }
    } catch (_) {}
  }

  function createFullFrameTeacherComp(name, teacherSource, duration, parentFolder, width, height, frameRate) {
    var comp = app.project.items.addComp(name, width, height, 1, duration, frameRate);
    if (parentFolder) comp.parentFolder = parentFolder;
    var layer = comp.layers.add(teacherSource);
    var r = Math.max(width / teacherSource.width, height / teacherSource.height);
    layer.transform.anchorPoint.setValue(centerAnchor(teacherSource));
    layer.transform.position.setValue([width / 2, height / 2, 0]);
    layer.transform.scale.setValue([r * 100, r * 100, 100]);
    extendFootageLayer(layer, duration);
    return comp;
  }

  function createKeyedTeacherComp(templateComp, name, teacherSource, duration, parentFolder, backgroundMode) {
    // Dental Formula applies the lower-left position/scale directly to the
    // teacher footage layer. Keep this helper comp source-sized so the master
    // layer's transform behaves the same way instead of scaling a 1920x1080
    // full-frame precomp.
    var comp = app.project.items.addComp(
      name,
      teacherSource.width,
      teacherSource.height,
      1,
      duration,
      templateComp.frameRate
    );
    if (parentFolder) comp.parentFolder = parentFolder;
    var teacherLayer = comp.layers.add(teacherSource);
    applyTeacherVideoTreatment(teacherLayer, backgroundMode);
    teacherLayer.audioEnabled = true;
    squashLayerTransform(
      teacherLayer,
      [teacherSource.width / 2, teacherSource.height / 2, 0],
      [100, 100, 100]
    );
    try { teacherLayer.transform.anchorPoint.setValue(centerAnchor(teacherSource)); } catch (_) {}
    extendFootageLayer(teacherLayer, duration);
    teacherLayer.startTime = 0;
    teacherLayer.inPoint = 0;
    teacherLayer.outPoint = duration;
    return comp;
  }

  // ── Animation helpers ──
  // Force a transform property's keyframes to clean linear motion with zero
  // spatial tangents. This kills After Effects' spatial auto-bezier "wander",
  // so once the final keyframe is reached the value is held perfectly still
  // (no drift, sliding, or gradual repositioning) for the rest of the comp.
  function lockMotionPath(prop) {
    if (!prop || !prop.numKeys) return;
    var zero = [0, 0, 0];
    for (var i = 1; i <= prop.numKeys; i++) {
      try { prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); } catch (_) {}
      try { prop.setSpatialAutoBezierAtKey(i, false); } catch (_) {}
      try { prop.setSpatialContinuousAtKey(i, false); } catch (_) {}
      try { prop.setSpatialTangentsAtKey(i, zero, zero); } catch (_) {}
    }
  }

  function animateSlideIn(layer, fromPosition, toPosition, startTime, endTime) {
    var pos = layer.transform.position;
    var opacity = layer.transform.opacity;
    pos.setValueAtTime(startTime, fromPosition);
    pos.setValueAtTime(endTime, toPosition);
    opacity.setValueAtTime(startTime, 0);
    opacity.setValueAtTime(endTime, 100);
  }

  function addSolidBanner(comp, name, color, width, height, position, inTime, outTime) {
    var layer = comp.layers.addSolid(color, name, width, height, 1, comp.duration);
    layer.transform.position.setValue(position);
    layer.inPoint = inTime;
    layer.outPoint = outTime;
    return layer;
  }

  // ── Teacher lower-third ──
  function addTeacherLowerThird(comp, mainText, subText, sceneStart, sceneEnd) {
    var inTime = sceneStart + 2.0;
    var revealTime = inTime + 0.28;
    var outTime = sceneEnd;
    var cw = comp.width || 1920;
    var wide = 820;
    var anchorCenterX = cw - wide / 2;
    var slidePx = 108;
    var subTrim = subText ? String(subText).replace(/^\\s+|\\s+$/g, "") : "";
    var hasSub = subTrim.length > 0;

    if (hasSub) {
      var whiteH = 78, blueH = 24;
      var whiteBarY = 856;
      var blueStripY = whiteBarY + whiteH / 2 + blueH / 2 + 2;
      var textInset = 34;
      var mainTextLeft = anchorCenterX - wide / 2 + textInset;
      var mainTextY = whiteBarY - whiteH / 2 + 8;
      var subTextLeft = mainTextLeft;
      var subTextY = blueStripY - blueH / 2 + 1;
      var nameBlue = [0.114, 0.345, 0.651];

      var whiteBar = addSolidBanner(comp, GENERATED_PREFIX + "Teacher_LT_White", [1, 1, 1], wide, whiteH, [anchorCenterX, whiteBarY, 0], inTime, outTime);
      var blueStrip = addSolidBanner(comp, GENERATED_PREFIX + "Teacher_LT_Blue", nameBlue, wide, blueH, [anchorCenterX, blueStripY, 0], inTime, outTime);

      var mainLayer = comp.layers.addText(mainText);
      setTextLayer(mainLayer, mainText, {
        font: "Arial-BoldMT", fontSize: 54, fillColor: nameBlue,
        justification: ParagraphJustification.LEFT_JUSTIFY,
        maxWidth: wide - textInset * 2, maxHeight: 54, minFontSize: 34, lockSize: true
      });
      positionTextLayer(mainLayer, mainTextLeft, mainTextY, "topLeft");
      mainLayer.inPoint = inTime; mainLayer.outPoint = outTime;

      var subLayer = comp.layers.addText(subTrim);
      setTextLayer(subLayer, subTrim, {
        font: "ArialMT", fontSize: 22, fillColor: [1, 1, 1],
        justification: ParagraphJustification.LEFT_JUSTIFY,
        maxWidth: wide - textInset * 2, maxHeight: 30, minFontSize: 16, lockSize: true
      });
      positionTextLayer(subLayer, subTextLeft, subTextY, "topLeft");
      subLayer.inPoint = inTime; subLayer.outPoint = outTime;

      animateSlideIn(whiteBar, [anchorCenterX + slidePx, whiteBarY, 0], [anchorCenterX, whiteBarY, 0], inTime, revealTime);
      animateSlideIn(blueStrip, [anchorCenterX + slidePx, blueStripY, 0], [anchorCenterX, blueStripY, 0], inTime + 0.04, revealTime + 0.04);
      animateSlideIn(mainLayer, [mainTextLeft + slidePx, mainTextY, 0], [mainTextLeft, mainTextY, 0], inTime + 0.06, revealTime + 0.06);
      animateSlideIn(subLayer, [subTextLeft + slidePx, subTextY, 0], [subTextLeft, subTextY, 0], inTime + 0.08, revealTime + 0.08);
      return;
    }

    // Single-line nameplate fallback
    var barWidth = 520, barHeight = 52, barY = 932, textY = barY - 2;
    var bar = addSolidBanner(comp, GENERATED_PREFIX + "Teacher_LT_Single", [0.12, 0.12, 0.12], barWidth, barHeight, [anchorCenterX, barY, 0], inTime, outTime);
    try { bar.opacity.setValue(82); } catch (_) {}
    var nameLayer = comp.layers.addText(mainText);
    setTextLayer(nameLayer, mainText, {
      font: "NotoSans-Bold", fontSize: 40, fillColor: [1, 1, 1], removeStroke: true,
      justification: ParagraphJustification.CENTER_JUSTIFY,
      maxWidth: barWidth - 48, maxHeight: 46, minFontSize: 28, lockSize: true
    });
    positionTextLayer(nameLayer, anchorCenterX, textY, "center");
    nameLayer.inPoint = inTime; nameLayer.outPoint = outTime;
    animateSlideIn(bar, [anchorCenterX + slidePx, barY, 0], [anchorCenterX, barY, 0], inTime, revealTime);
    animateSlideIn(nameLayer, [anchorCenterX + slidePx, textY, 0], [anchorCenterX, textY, 0], inTime + 0.06, revealTime + 0.08);
  }

  // ── Board layout helpers ──
  // Single source of truth for every board scene's header so they all share an
  // identical font, size (fixed — never auto-shrunk), spacing, position, and
  // styling. Body text always sits well below BOARD_HEADER_POSITION.
  function styleBoardHeader(layer, text, inPoint, outPoint) {
    if (!layer) return;
    try { layer.enabled = true; } catch (_) {}
    squashLayerTransform(layer, BOARD_HEADER_POSITION, [100, 100, 100]);
    var wrappedHeader = wrapTextPreservingWords(text, 34);
    setTextLayer(layer, wrappedHeader, {
      font: "NotoSans-Bold", fontSize: BOARD_HEADER_FONT_SIZE,
      leading: 56,
      fillColor: [0.188, 0.188, 0.188], removeStroke: true,
      justification: ParagraphJustification.CENTER_JUSTIFY,
      maxWidth: BOARD_HEADER_MAX_WIDTH, maxHeight: 116,
      minFontSize: BOARD_HEADER_FONT_SIZE, lockSize: true
    });
    positionTextLayer(layer, BOARD_HEADER_POSITION[0], BOARD_HEADER_POSITION[1], "topCenter");
    setLayerTimeRange(layer, inPoint, outPoint);
  }

  function stylePairHeader(layer, text, inPoint, outPoint) {
    if (!layer) return;
    squashLayerTransform(layer, PAIR_HEADER_POSITION, [100, 100, 100]);
    setTextLayer(layer, wrapTextPreservingWords(text, 34), {
      font: "NotoSans-Bold", fontSize: BOARD_HEADER_FONT_SIZE,
      leading: 56,
      fillColor: [1, 1, 1], removeStroke: true,
      justification: ParagraphJustification.CENTER_JUSTIFY,
      maxWidth: 940, maxHeight: 116,
      minFontSize: BOARD_HEADER_FONT_SIZE, lockSize: true
    });
    positionTextLayer(layer, PAIR_HEADER_POSITION[0], PAIR_HEADER_POSITION[1], "topCenter");
    setLayerTimeRange(layer, inPoint, outPoint);
  }

  function ensureLessonClipboardOnBoard(comp) {
    try {
      var clip = findLayerByRegex(comp, /clipboard|board|board_clipboard/i) || getLayer(comp, 39);
      if (!clip) return;
      clip.enabled = true;
      clip.inPoint = 0;
      clip.outPoint = comp.duration;
      squashLayerTransform(clip, PAIR_CLIPBOARD_POSITION, PAIR_CLIPBOARD_SCALE);
    } catch (_) {}
  }

  function freezeBoardLessonLayout(comp) {
    ensureLessonClipboardOnBoard(comp);
    setLayerEnabled(comp, 40, false);
  }

  // ════════════════════════════════════════════════
  // SCENE CONFIGURATION FUNCTIONS
  // Each duplicates the "Pro" comp and configures
  // specific layers by their template index.
  // ════════════════════════════════════════════════

  function configureTeacherSceneBase(comp, scene) {
    setLayerEnabled(comp, 1, false);
    setLayerEnabled(comp, 37, false);
    setLayerAudioEnabled(comp, 37, false);
  }

  function configureTitleScene(comp, scene) {
    disableLayers(comp, 1, 44);
    setLayerEnabled(comp, 2, true);
    setLayerEnabled(comp, 3, true);
    setLayerEnabled(comp, 4, true);
    setLayerEnabled(comp, 5, true);
    setLayerEnabled(comp, 6, true);
    setLayerEnabled(comp, 7, true);

    var introLayer = findLayerByRegex(comp, /biology.*(?:theam|theme)|chemistry.*intro|subject.*intro/i) || getLayer(comp, 8);
    if (scene.introSource && introLayer) {
      replaceLayerSourceKeepTiming(introLayer, scene.introSource);
      introLayer.enabled = true;
      introLayer.blendingMode = BlendingMode.NORMAL;
      setLayerTimeRange(introLayer, 0, scene.duration);
    } else if (introLayer) {
      introLayer.enabled = true;
      setLayerTimeRange(introLayer, 0, scene.duration);
    }

    // Layer 3 = topic title text, Layer 4 = subject text
    var titleLayer = findLayerByName(comp, "Dental Formula") || getLayer(comp, 3);
    var subjectLayer = findLayerByName(comp, "Biology") || getLayer(comp, 4);
    setTextLayer(titleLayer, MANIFEST.video_title, {
      font: "Arial-BoldItalicMT", fontSize: 65,
      fillColor: [1, 1, 1], strokeColor: [1, 1, 1], strokeWidth: 1,
      maxWidth: 760, maxHeight: 90, minFontSize: 48, lockSize: false
    });
    movePropertyToPositionPreserveKeys(titleLayer.transform.position, [920, 511, 0]);
    setLayerTimeRange(titleLayer, 0, scene.duration);
    setTextLayer(subjectLayer, MANIFEST.subject || "Subject", {
      font: "ArialMT", fontSize: 55,
      fillColor: [1, 1, 1], strokeColor: [1, 1, 1], strokeWidth: 1,
      maxWidth: 320, maxHeight: 70, minFontSize: 38, lockSize: false
    });
    movePropertyToPositionPreserveKeys(subjectLayer.transform.position, [922, 588, 0]);
    setLayerTimeRange(subjectLayer, 0, scene.duration);
  }

  function configureOutroScene(comp, scene) {
    disableLayers(comp, 1, 44);
  }

  function configureCenterScene(comp, scene) {
    resetCenterTemplate(comp);
    configureTeacherSceneBase(comp, scene);
    // Add teacher lower-third
    if (scene.lowerThirdMain) {
      addTeacherLowerThird(
        comp,
        scene.lowerThirdMain,
        scene.lowerThirdSub || "",
        SEGMENTS.center.start,
        SEGMENTS.center.start + scene.duration
      );
    }
  }

  function configurePairScene(comp, scene) {
    resetCenterTemplate(comp);
    configureTeacherSceneBase(comp, scene);

    var pairStart = SEGMENTS.pair.start;
    var pairEnd = pairStart + scene.duration;

    // Replace layer 36 with the pair board comp
    if (scene.pairBoardComp) {
      var leftLayer = getLayer(comp, 36);
      leftLayer = replaceTemplateLayerOrAdd(comp, 36, scene.pairBoardComp, GENERATED_PREFIX + "Pair_Images");
      leftLayer.enabled = true;
      leftLayer.blendingMode = BlendingMode.NORMAL;
      leftLayer.startTime = pairStart;
      try {
        leftLayer.transform.anchorPoint.setValue([SINGLE_CANVAS.width / 2, SINGLE_CANVAS.height / 2, 0]);
        squashLayerTransform(leftLayer, [1346, 522, 0], [100, 100, 100]);
      } catch (_) {}
      setLayerTimeRange(leftLayer, pairStart, pairEnd);
    }

    // Header text
    var headerLayer = comp.layers.addText(scene.header || "Previously");
    headerLayer.name = GENERATED_PREFIX + "Pair_Header";
    stylePairHeader(headerLayer, scene.header || "Previously", pairStart, pairEnd);

    // Body text
    if (scene.body) {
      addBoardBodyBoxLayer(comp, [1310, 286], { width: 920, height: 82, wrapChars: 52 },
        scene.body, pairStart, pairEnd, {
          font: "NotoSans-Regular", fontSize: 34, leading: 40,
          fillColor: [1, 1, 1], removeStroke: true,
          justification: ParagraphJustification.CENTER_JUSTIFY,
          maxWidth: 920, maxHeight: 82, minFontSize: 24, lockSize: false,
          anchorMode: "topCenter"
        });
    }

    // Pair captions
    var boardCenterX = 1346;
    var captionY = 708;
    var captionStyle = {
      font: "NotoSans-Regular", fontSize: 28,
      fillColor: [1, 1, 1], removeStroke: true,
      justification: ParagraphJustification.CENTER_JUSTIFY,
      maxWidth: 300, maxHeight: 40, minFontSize: 18, lockSize: false, anchorMode: "topCenter"
    };
    addSceneTextLayer(comp, scene.leftLabel || "Left", boardCenterX - 280, captionY, 300, 40,
      pairStart + 0.8, pairEnd, captionStyle);
    addSceneTextLayer(comp, scene.rightLabel || "Right", boardCenterX + 280, captionY, 300, 40,
      pairStart + 0.8, pairEnd, captionStyle);
  }

  function configureSingleBoardScene(comp, scene) {
    resetBoardTemplate(comp);
    configureTeacherSceneBase(comp, scene);
    ensureLessonClipboardOnBoard(comp);

    var segment = SEGMENTS.single;
    var sceneEnd = segment.start + scene.duration;

    // Use a fresh, static header layer so no template motion or old text keys
    // can shift or clip the heading.
    var headerLayer = comp.layers.addText(scene.header || scene.title);
    headerLayer.name = GENERATED_PREFIX + "Single_Header";
    styleBoardHeader(headerLayer, scene.header || scene.title, segment.start, sceneEnd);

    // Image on layer 29
    if (scene.imageComp) {
      var imageLayer = getLayer(comp, 29);
      imageLayer = replaceTemplateLayerOrAdd(comp, 29, scene.imageComp, GENERATED_PREFIX + "Single_Image");
      imageLayer.enabled = true;
      imageLayer.blendingMode = BlendingMode.NORMAL;
      imageLayer.startTime = segment.start;
      placeBoardImageLayer(imageLayer, SINGLE_CANVAS.width, SINGLE_CANVAS.height);
      setLayerTimeRange(imageLayer, segment.start, sceneEnd);
    }

    // Body text
    if (scene.body) {
      addBoardBodyBoxLayer(comp, [1274, 305], { width: 860, height: 92, wrapChars: 56 },
        scene.body, segment.start, sceneEnd, {
          font: "NotoSans-Regular", fontSize: 28, leading: 33,
          fillColor: [0.278, 0.278, 0.278], removeStroke: true,
          justification: ParagraphJustification.CENTER_JUSTIFY,
          maxWidth: 860, maxHeight: 92, minFontSize: 18, lockSize: false,
          anchorMode: "topCenter"
        });
    }
  }

  function configureTripleBoardScene(comp, scene) {
    resetBoardTemplate(comp);
    configureTeacherSceneBase(comp, scene);
    ensureLessonClipboardOnBoard(comp);
    freezeBoardLessonLayout(comp);

    var segment = SEGMENTS.triple;
    var sceneEnd = segment.start + scene.duration;

    // Image on layer 13
    if (scene.imageComp) {
      var imageLayer = getLayer(comp, 13);
      imageLayer = replaceTemplateLayerOrAdd(comp, 13, scene.imageComp, GENERATED_PREFIX + "Triple_Image");
      imageLayer.enabled = true;
      imageLayer.blendingMode = BlendingMode.NORMAL;
      imageLayer.startTime = segment.start;
      placeBoardImageLayer(imageLayer, TRIPLE_CANVAS.width, TRIPLE_CANVAS.height);
      setLayerTimeRange(imageLayer, segment.start, sceneEnd);
    }

    var tripleHeaderLayer = comp.layers.addText(scene.header || scene.title);
    tripleHeaderLayer.name = GENERATED_PREFIX + "Triple_Header";
    styleBoardHeader(tripleHeaderLayer, scene.header || scene.title, segment.start, sceneEnd);

    // Body text — timed steps or static
    if (scene.bodySteps && scene.bodySteps.length) {
      for (var bi = 0; bi < scene.bodySteps.length; bi++) {
        var step = scene.bodySteps[bi];
        if (!step.text) continue;
        addBoardBodyBoxLayer(comp, [1274, 340], { width: 1020, height: 116, wrapChars: 62 },
          step.text, segment.start + step.start, Math.min(sceneEnd, segment.start + step.end), {
            font: "NotoSans-Regular", fontSize: 28, leading: 34,
            fillColor: [0.278, 0.278, 0.278], removeStroke: true,
            justification: ParagraphJustification.CENTER_JUSTIFY,
            maxWidth: 1020, maxHeight: 116, minFontSize: 20, lockSize: false,
            anchorMode: "topCenter"
          });
      }
    } else if (scene.body) {
      addBoardBodyBoxLayer(comp, [1274, 340], { width: 1020, height: 116, wrapChars: 62 },
        scene.body, segment.start, sceneEnd, {
          font: "NotoSans-Regular", fontSize: 28, leading: 34,
          fillColor: [0.278, 0.278, 0.278], removeStroke: true,
          justification: ParagraphJustification.CENTER_JUSTIFY,
          maxWidth: 1020, maxHeight: 116, minFontSize: 20, lockSize: false,
          anchorMode: "topCenter"
        });
    }
  }

  function configureSummaryScene(comp, scene) {
    resetBoardTemplate(comp);
    configureTeacherSceneBase(comp, scene);
    freezeBoardLessonLayout(comp);

    var segment = SEGMENTS.triple; // summary uses triple timing
    var sceneEnd = segment.start + scene.duration;

    if (scene.imageComp) {
      var imageLayer = getLayer(comp, 13);
      imageLayer = replaceTemplateLayerOrAdd(comp, 13, scene.imageComp, GENERATED_PREFIX + "Summary_Image");
      imageLayer.enabled = true;
      imageLayer.blendingMode = BlendingMode.NORMAL;
      imageLayer.startTime = segment.start;
      placeBoardImageLayer(imageLayer, TRIPLE_CANVAS.width, TRIPLE_CANVAS.height);
      setLayerTimeRange(imageLayer, segment.start, sceneEnd);
    }

    var summaryHeaderLayer = comp.layers.addText(scene.header || "Summary");
    summaryHeaderLayer.name = GENERATED_PREFIX + "Summary_Header";
    styleBoardHeader(summaryHeaderLayer, scene.header || "Summary", segment.start, sceneEnd);

    if (scene.body) {
      addBoardBodyBoxLayer(comp, [1274, 340], { width: 940, height: 116, wrapChars: 50 },
        scene.body, segment.start, sceneEnd, {
          font: "NotoSans-Regular", fontSize: 28, leading: 34,
          fillColor: [0.278, 0.278, 0.278], removeStroke: true,
          justification: ParagraphJustification.CENTER_JUSTIFY,
          maxWidth: 940, maxHeight: 116, minFontSize: 20, lockSize: false,
          anchorMode: "topCenter"
        });
    }
  }

  // ════════════════════════════════════════════════
  // CREATE CONFIGURED SCENE COMP
  // ════════════════════════════════════════════════
  function createConfiguredSceneComp(templateComp, scene, generatedFolder) {
    var sceneComp = duplicateTemplateComp(templateComp, scene.name || scene.id, generatedFolder);
    sceneComp.duration = scene.segment.start + scene.duration + 0.25;
    if (scene.type === "title") {
      configureTitleScene(sceneComp, scene);
    } else if (scene.type === "outro") {
      configureOutroScene(sceneComp, scene);
    } else if (scene.type === "center") {
      configureCenterScene(sceneComp, scene);
    } else if (scene.type === "pair") {
      configurePairScene(sceneComp, scene);
    } else if (scene.type === "single") {
      configureSingleBoardScene(sceneComp, scene);
    } else if (scene.type === "triple") {
      configureTripleBoardScene(sceneComp, scene);
    } else if (scene.type === "summary") {
      configureSummaryScene(sceneComp, scene);
    } else {
      // Fallback to single
      configureSingleBoardScene(sceneComp, scene);
    }
    return sceneComp;
  }

  function isBoardSceneType(type) {
    return type === "single" || type === "triple" || type === "summary";
  }

  function isTeacherLeftSceneType(type) {
    return type === "pair" || isBoardSceneType(type);
  }

  // ════════════════════════════════════════════════
  // SUBTITLE SYSTEM
  // ════════════════════════════════════════════════
  function addMasterSubtitleLayer(masterComp, text, inPoint, outPoint) {
    var subtitleText = String(text).replace(/\\r\\n|\\r|\\n/g, " ").replace(/\\s+/g, " ").replace(/^\\s+|\\s+$/g, "");
    if (!subtitleText || outPoint <= inPoint) return null;
    var barCenterY = masterComp.height - SUBTITLE_BAR_HEIGHT / 2;
    var textCenterY = barCenterY + 1;

    var bgLayer = masterComp.layers.addSolid(
      [0.33, 0.33, 0.33],
      GENERATED_PREFIX + "Sub_BG_" + Math.round(inPoint * 100),
      masterComp.width, SUBTITLE_BAR_HEIGHT, 1, masterComp.duration
    );
    bgLayer.opacity.setValue(SUBTITLE_BAR_OPACITY);
    bgLayer.transform.anchorPoint.setValue([masterComp.width / 2, SUBTITLE_BAR_HEIGHT / 2, 0]);
    bgLayer.transform.position.setValue([masterComp.width / 2, barCenterY, 0]);
    setLayerTimeRange(bgLayer, inPoint, outPoint);

    var fillLayer = masterComp.layers.addText(subtitleText);
    setTextLayer(fillLayer, subtitleText, {
      font: SUBTITLE_FONT, fontSize: SUBTITLE_FONT_SIZE,
      fillColor: [1, 1, 1], removeStroke: true,
      justification: ParagraphJustification.CENTER_JUSTIFY,
      maxWidth: masterComp.width - SUBTITLE_SIDE_PADDING * 2,
      maxHeight: SUBTITLE_BAR_HEIGHT - 10,
      minFontSize: 16,
      lockSize: false
    });
    setLayerTimeRange(fillLayer, inPoint, outPoint);
    positionTextLayer(fillLayer, masterComp.width / 2, textCenterY, "center");
    return fillLayer;
  }

  function addMasterSubtitles(masterComp, sceneSpecs) {
    var currentTime = 0;
    for (var i = 0; i < sceneSpecs.length; i++) {
      var scene = sceneSpecs[i];
      if (scene.subtitles && scene.subtitles.length) {
        for (var j = 0; j < scene.subtitles.length; j++) {
          var block = scene.subtitles[j];
          var subtitleStart = currentTime + block.start;
          var subtitleEnd = currentTime + block.end;
          addMasterSubtitleLayer(masterComp, block.text, subtitleStart, subtitleEnd);
        }
      }
      currentTime += scene.duration;
    }
  }

  // ════════════════════════════════════════════════
  // MASTER COMP ASSEMBLY
  // ════════════════════════════════════════════════
  function addSceneLayer(masterComp, sceneComp, segment, timelineStart) {
    var layer = masterComp.layers.add(sceneComp);
    layer.startTime = timelineStart - segment.start;
    layer.inPoint = timelineStart;
    layer.outPoint = timelineStart + segment.playDuration;
    return layer;
  }

  // ════════════════════════════════════════════════
  // MAIN BUILD
  // ════════════════════════════════════════════════
  app.beginUndoGroup(SCRIPT_NAME);
  log("=== Building: " + MANIFEST.project_name + " ===");

  var fixed = MANIFEST.asset_plan.fixed || {};

  // ── Find the template comp ──
  var templateComp = findCompByName(TEMPLATE_COMP_NAME);
  if (!templateComp) {
    throw new Error("Template comp '" + TEMPLATE_COMP_NAME + "' not found. Make sure the Dental Formula .aep is open.");
  }

  // ── Clean up any previous generated items ──
  var removed = true;
  while (removed) {
    removed = false;
    for (var ci = app.project.numItems; ci >= 1; ci--) {
      var cItem = app.project.item(ci);
      if (cItem.name === MASTER_COMP_NAME || cItem.name.indexOf(GENERATED_PREFIX) === 0) {
        try { cItem.remove(); removed = true; } catch (_) {}
      }
    }
  }

  var generatedFolder = ensureProjectFolder(GENERATED_PREFIX + "Generated");
  var projectAssetFolder = ensureProjectFolder(GENERATED_PREFIX + "Assets", generatedFolder);

  // ── Import assets ──
  var teacherItem = null;
  var tvName = MANIFEST.asset_plan.teacher_video;
  if (tvName) {
    teacherItem = safeImport(assetsFolder.fsName + "/" + tvName);
  }
  if (!teacherItem && fixed.presenter_video) {
    teacherItem = safeImport(fixedFolder.fsName + "/" + fixed.presenter_video);
  }

  var introItem = null;
  if (fixed.intro_video) {
    introItem = safeImport(fixedFolder.fsName + "/" + fixed.intro_video);
  }

  var voiceoverItem = null;
  if (MANIFEST.asset_plan.voiceover) {
    voiceoverItem = safeImport(assetsFolder.fsName + "/" + MANIFEST.asset_plan.voiceover);
  }
  var teacherBackgroundMode = MANIFEST.asset_plan.teacher_video_background || "white_or_light";

  var imageItems = {};
  var imgList = MANIFEST.asset_plan.images || [];
  for (var ii = 0; ii < imgList.length; ii++) {
    var img = safeImport(assetsFolder.fsName + "/" + imgList[ii]);
    if (img) imageItems[imgList[ii]] = img;
  }

  // ── Map scene types to segments ──
  function getSegmentForType(type) {
    if (type === "title") return SEGMENTS.title;
    if (type === "outro") return SEGMENTS.outro;
    if (type === "pair") return SEGMENTS.pair;
    if (type === "center") return SEGMENTS.center;
    if (type === "single") return SEGMENTS.single;
    if (type === "triple") return SEGMENTS.triple;
    if (type === "summary") return SEGMENTS.triple; // summary uses triple timing
    return SEGMENTS.single;
  }

  // ── Build scene specs ──
  var sceneSpecs = [];
  for (var s = 0; s < MANIFEST.scenes.length; s++) {
    var mScene = MANIFEST.scenes[s];
    var effectiveType = mScene.type;
    if (effectiveType === "title" && s !== 0) effectiveType = "single";
    if (effectiveType === "outro" && s !== MANIFEST.scenes.length - 1) effectiveType = "single";
    var segment = getSegmentForType(effectiveType);
    var images = mScene.image_files || [];

    var visibleHeader = sanitizeVisibleText(mScene.header || mScene.on_screen_text || mScene.title || "");
    var visibleTitle = sanitizeVisibleText(mScene.title || "");
    var visibleBody = sanitizeVisibleText(mScene.body || "");
    var visibleBodySteps = sanitizeTimedTextBlocks(mScene.body_steps || []);
    var visibleSubtitles = sanitizeTimedTextBlocks(mScene.subtitles || []);

    var spec = {
      name: mScene.id || ("Scene_" + (s + 1)),
      type: effectiveType,
      segment: segment,
      duration: mScene.duration || segment.playDuration,
      header: visibleHeader,
      title: visibleTitle,
      body: visibleBody,
      teacherSource: teacherItem,
      lowerThirdMain: mScene.lower_third_main || null,
      lowerThirdSub: mScene.lower_third_sub || null,
      leftLabel: sanitizeVisibleText(mScene.left_label || "Left"),
      rightLabel: sanitizeVisibleText(mScene.right_label || "Right"),
      subtitles: visibleSubtitles,
      bodySteps: visibleBodySteps,
      introSource: introItem,
      imageComp: null,
      pairBoardComp: null
    };

    // Create image helper comps based on scene type
    var availableImages = [];
    for (var ai = 0; ai < images.length; ai++) {
      if (imageItems[images[ai]]) availableImages.push(imageItems[images[ai]]);
    }

    if ((effectiveType === "single" || effectiveType === "triple" || effectiveType === "summary") && availableImages.length > 0) {
      var hasBodyText = !!(visibleBody || visibleBodySteps.length);
      var safeImageRect = boardImageSafeRect(effectiveType, hasBodyText);
      if (availableImages.length === 1) {
        var helperWidth = effectiveType === "single" ? SINGLE_CANVAS.width : TRIPLE_CANVAS.width;
        var helperHeight = effectiveType === "single" ? SINGLE_CANVAS.height : TRIPLE_CANVAS.height;
        spec.imageComp = createTimedSequenceComp(
          GENERATED_PREFIX + "Helper_" + spec.name,
          helperWidth, helperHeight,
          [{
            source: availableImages[0],
            mode: "fit",
            rect: safeImageRect,
            start: 0,
            end: spec.duration
          }],
          generatedFolder, spec.duration
        );
      } else {
        var stages = [];
        for (var ti = 0; ti < availableImages.length; ti++) {
          stages.push({
            source: availableImages[ti],
            mode: "fit",
            rect: safeImageRect,
            start: spec.duration * (ti / availableImages.length),
            end: spec.duration * ((ti + 1) / availableImages.length)
          });
        }
        var sequenceWidth = effectiveType === "single" ? SINGLE_CANVAS.width : TRIPLE_CANVAS.width;
        var sequenceHeight = effectiveType === "single" ? SINGLE_CANVAS.height : TRIPLE_CANVAS.height;
        spec.imageComp = createTimedSequenceComp(
          GENERATED_PREFIX + "Helper_" + spec.name,
          sequenceWidth, sequenceHeight,
          stages, generatedFolder, spec.duration
        );
      }
    } else if (effectiveType === "pair" && images.length >= 2 && imageItems[images[0]] && imageItems[images[1]]) {
      spec.pairBoardComp = createPreviousPairBoardComp(
        GENERATED_PREFIX + "Helper_" + spec.name,
        imageItems[images[0]], imageItems[images[1]],
        generatedFolder, spec.duration
      );
    }

    sceneSpecs.push(spec);
  }

  // ── Calculate total duration ──
  var totalDuration = 0;
  for (var td = 0; td < sceneSpecs.length; td++) {
    totalDuration += sceneSpecs[td].duration;
  }

  // ── Build master comp ──
  var master = app.project.items.addComp(
    MASTER_COMP_NAME,
    templateComp.width, templateComp.height,
    templateComp.pixelAspect,
    totalDuration,
    templateComp.frameRate
  );
  master.parentFolder = generatedFolder;

  // 1. Add Continuous Background
  var bgItem = null;
  if (MANIFEST.asset_plan.fixed.background) {
    bgItem = safeImport(fixedFolder.fsName + "/" + MANIFEST.asset_plan.fixed.background);
  }
  if (bgItem) {
    var bgLayer = master.layers.add(bgItem);
    bgLayer.startTime = 0;
    // Loop the background to match total duration (if it's a video)
    try {
      if (bgItem.hasVideo && bgItem.duration > 0 && totalDuration > bgItem.duration) {
        if (bgLayer.canSetTimeRemapEnabled) {
          bgLayer.timeRemapEnabled = true;
          bgLayer.property("Time Remap").expression = "loopOut('cycle')";
        }
      }
    } catch(e) {
      // Ignore exception: AE throws error for still images even if canSetTimeRemapEnabled is true
    }
    bgLayer.outPoint = totalDuration;
    // Scale to fit 1920x1080
    var scaleX = (1920 / bgItem.width) * 100;
    var scaleY = (1080 / bgItem.height) * 100;
    var s = Math.max(scaleX, scaleY);
    bgLayer.transform.anchorPoint.setValue(centerAnchor(bgItem));
    bgLayer.transform.position.setValue([master.width / 2, master.height / 2, 0]);
    bgLayer.transform.scale.setValue([s, s, 100]);
  }

  // 2. Prepare teacher treatments. Center and board scenes both use keyed
  // presenter video so the teacher background is removed consistently.
  var teacherComp = null;
  if (teacherItem) {
    teacherComp = createKeyedTeacherComp(
      templateComp,
      GENERATED_PREFIX + "Teacher_Full_Frame",
      teacherItem, totalDuration, generatedFolder, teacherBackgroundMode
    );
  }

  // Build every scene first so timing and layer order are explicit.
  var sceneRecords = [];
  var currentTime = 0;
  for (var ms = 0; ms < sceneSpecs.length; ms++) {
    var specItem = sceneSpecs[ms];
    log("Creating scene: " + specItem.name + " [" + specItem.type + "]");
    var sceneComp = createConfiguredSceneComp(templateComp, specItem, generatedFolder);
    sceneRecords.push({
      spec: specItem,
      comp: sceneComp,
      start: currentTime,
      end: currentTime + specItem.duration
    });
    currentTime += specItem.duration;
  }

  // One continuous keyed teacher layer appears centered, moves once to the
  // lower-left teaching position, and remains fixed there for all later scenes.
  var masterTeacherLayer = null;
  if (teacherComp) {
    var firstCenterRecord = null;
    var firstTeacherLeftRecord = null;
    var firstBoardRecord = null;
    var lastTeacherRecord = null;
    for (var tr = 0; tr < sceneRecords.length; tr++) {
      var teacherRecord = sceneRecords[tr];
      var teacherType = teacherRecord.spec.type;
      if (!firstCenterRecord && teacherType === "center") firstCenterRecord = teacherRecord;
      if (!firstTeacherLeftRecord && isTeacherLeftSceneType(teacherType)) firstTeacherLeftRecord = teacherRecord;
      if (!firstBoardRecord && isBoardSceneType(teacherType)) firstBoardRecord = teacherRecord;
      if (teacherType === "center" || isTeacherLeftSceneType(teacherType)) lastTeacherRecord = teacherRecord;
    }

    if (firstCenterRecord || firstTeacherLeftRecord) {
      var teacherLayer = master.layers.add(teacherComp);
      masterTeacherLayer = teacherLayer;
      var teacherIn = firstCenterRecord ? firstCenterRecord.start : firstTeacherLeftRecord.start;
      var teacherOut = lastTeacherRecord ? lastTeacherRecord.end : totalDuration;
      teacherLayer.startTime = teacherIn;
      teacherLayer.inPoint = teacherIn;
      teacherLayer.outPoint = teacherOut;
      teacherLayer.audioEnabled = !voiceoverItem;

      var teacherPos = teacherLayer.transform.position;
      var teacherScale = teacherLayer.transform.scale;
      var teacherOpacity = teacherLayer.transform.opacity;
      var centerPosition = [960, 540, 0];
      var centerScale = [100, 100, 100];
      var boardTeacherScale = BOARD_TEACHER_SCALE;
      try {
        if (teacherComp.width && teacherComp.width > 1280) {
          var scaledTeacher = BOARD_TEACHER_SCALE[0] * (1280 / teacherComp.width);
          boardTeacherScale = [scaledTeacher, scaledTeacher, 100];
        }
      } catch (_) {}

      // Fade the teacher in at entrance — no sudden pop-in.
      teacherOpacity.setValueAtTime(teacherIn, 0);
      teacherOpacity.setValueAtTime(Math.min(teacherOut, teacherIn + FADE_TIME), 100);

      if (firstCenterRecord && firstTeacherLeftRecord) {
        // Hold in the centre, make one immediate move when teaching content
        // begins, then explicitly hold the exact final transform to teacherOut.
        var transitionStart = firstTeacherLeftRecord.start;
        var transitionEnd = Math.min(firstTeacherLeftRecord.end - 0.2, transitionStart + TEACHER_MOVE_TIME);
        teacherPos.setValueAtTime(teacherIn, centerPosition);
        teacherScale.setValueAtTime(teacherIn, centerScale);
        teacherPos.setValueAtTime(transitionStart, centerPosition);
        teacherScale.setValueAtTime(transitionStart, centerScale);
        teacherPos.setValueAtTime(transitionEnd, BOARD_TEACHER_POSITION);
        teacherScale.setValueAtTime(transitionEnd, boardTeacherScale);
        teacherPos.setValueAtTime(teacherOut, BOARD_TEACHER_POSITION);
        teacherScale.setValueAtTime(teacherOut, boardTeacherScale);
        lockMotionPath(teacherPos);
        lockMotionPath(teacherScale);
      } else if (firstTeacherLeftRecord) {
        teacherPos.setValue(BOARD_TEACHER_POSITION);
        teacherScale.setValue(boardTeacherScale);
      } else {
        teacherPos.setValue(centerPosition);
        teacherScale.setValue(centerScale);
      }
    }
  }

  // Scene comps are hard-clipped to their own windows, so adjacent videos and
  // boards can never overlap.
  for (var sr = 0; sr < sceneRecords.length; sr++) {
    var record = sceneRecords[sr];
    var specRecord = record.spec;
    var sceneLayer = master.layers.add(record.comp);
    sceneLayer.startTime = record.start - specRecord.segment.start;
    sceneLayer.inPoint = record.start;
    sceneLayer.outPoint = record.end;
    try {
      var sceneOpacity = sceneLayer.transform.opacity;
      if (specRecord.type === "center") {
        sceneOpacity.setValueAtTime(record.start, 0);
        sceneOpacity.setValueAtTime(Math.min(record.end, record.start + FADE_TIME), 100);
        sceneOpacity.setValueAtTime(record.end, 100);
      } else if (firstBoardRecord && record === firstBoardRecord) {
        // The clipboard is revealed exactly once. Every later board scene cuts
        // directly to new content while the identical static board stays put.
        var boardFadeStart = record.start;
        if (firstTeacherLeftRecord === firstBoardRecord && firstCenterRecord) {
          boardFadeStart = Math.min(record.end, record.start + TEACHER_MOVE_TIME);
        }
        var boardFadeEnd = Math.min(record.end, boardFadeStart + FADE_TIME);
        sceneOpacity.setValueAtTime(record.start, 0);
        sceneOpacity.setValueAtTime(boardFadeStart, 0);
        sceneOpacity.setValueAtTime(boardFadeEnd, 100);
        sceneOpacity.setValueAtTime(record.end, 100);
      }
    } catch (_) {}
  }

  if (masterTeacherLayer) {
    // Keep the teacher in front of the board, like the Dental Formula comp.
    // Subtitles are added after this, so they still sit above the teacher.
    try { masterTeacherLayer.moveToBeginning(); } catch (_) {}
  }

  if (voiceoverItem) {
    var voiceoverLayer = master.layers.add(voiceoverItem);
    voiceoverLayer.startTime = 0;
    voiceoverLayer.inPoint = 0;
    voiceoverLayer.outPoint = Math.min(totalDuration, voiceoverItem.duration || totalDuration);
    voiceoverLayer.audioEnabled = true;
  }

  // ── Add subtitles ──
  addMasterSubtitles(master, sceneSpecs);

  // ── Open master comp ──
  master.openInViewer();
  log("Build complete: " + master.name + " (" + totalDuration + "s, " + master.numLayers + " layers)");
  app.endUndoGroup();
  alert(
    "Lesson built!\\n\\n" +
    MANIFEST.project_name + "\\n" +
    "Duration: " + totalDuration + "s\\n" +
    master.numLayers + " layers\\n\\n" +
    "Open: " + MASTER_COMP_NAME
  );
})();`;

  return jsx.replace("__MANIFEST__", manifestJson);
}

/**
 * Generates the runner JSX that opens the template .aep then runs the generator.
 * Matches the ae_run_photosynthesis_generator.jsx pattern.
 *
 * @param topicSlug - topic name used for the output filename
 */
export function generateRunnerJsx(topicSlug: string): string {
  return `(function () {
    var root = new File($.fileName).parent;
    var projectFile = new File(root.fsName + "/template/Dental Formula (converted).aep");
    var generatorFile = new File(root.fsName + "/lesson_generator.jsx");
    var saveFile = new File(root.fsName + "/${topicSlug}_generated.aep");

    if (!projectFile.exists) {
        throw new Error("Template .aep not found: " + projectFile.fsName);
    }
    if (!generatorFile.exists) {
        throw new Error("Generator file not found: " + generatorFile.fsName);
    }

    app.exitAfterLaunchAndEval = true;
    app.beginSuppressDialogs();
    try {
        app.open(projectFile);
        $.evalFile(generatorFile);
        app.project.save(saveFile);
    } finally {
        try {
            if (app.project) {
                app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            }
        } catch (closeErr) {
        }
        app.endSuppressDialogs(false);
    }
})();
`;
}

export function generateReadme(topic: string, subject: string, topicSlug: string): string {
  return `Edubee Lesson Package — Template-Faithful Build
================================================
Topic:   ${topic}
Subject: ${subject}

Architecture:
-------------
This package uses the Dental Formula template approach:
- The "Pro" comp in the template .aep contains all built-in
  animations, transitions, and layer ordering.
- Each scene duplicates the "Pro" comp and configures specific
  layers (text, images, teacher video) while preserving animations.
- A master comp assembles all scene sub-comps with proper timing.

How to use:
-----------
1. EXTRACT this ZIP to a folder
2. Open After Effects
3. File > Scripts > Run Script File
4. Select ae_run_${topicSlug}_generator.jsx
   - This opens the template .aep automatically
   - Then runs the generator to build all scenes
5. Open the master comp to preview

Verification:
-------------
After building, you can verify the output:
1. Run ae_inspect_generated.jsx to generate a verification report
2. Run ae_export_qa_frames.jsx to export PNG frames at each scene midpoint
3. Check verification_report.txt for layer counts and positioning

Files:
------
template/                    (Dental Formula .aep template)
lesson_manifest.json         (Scene plan data)
lesson_generator.jsx         (Main generator — configures template)
ae_run_${topicSlug}_generator.jsx  (Runner — opens template + runs generator)
ae_inspect_generated.jsx     (Verification — layer inspection)
ae_export_qa_frames.jsx      (QA — export frame captures)
assets/                      (Your uploaded files)
fixed_assets/                (Template footage files)
`;
}
