/**
 * Generates After Effects JSX scripts for verifying the generated project.
 *
 * 1. Inspection script — walks the master comp, logs layer info to a text file
 * 2. QA frame export script — exports PNG frames at each scene's midpoint
 */

/**
 * Generate the inspection JSX script.
 * When run in AE, it produces a verification_report.txt with:
 * - Master comp info (size, duration, layer count)
 * - Per-layer details (name, type, in/out points, position, scale, text, effects)
 * - Scene sub-comp analysis
 */
export function generateInspectionJsx(masterCompName: string): string {
  return `(function () {
  var MASTER_COMP_NAME = ${JSON.stringify(masterCompName)};
  var scriptFile = new File($.fileName);
  var outputPath = scriptFile.parent.fsName + "/verification_report.txt";

  function log(msg) { try { $.writeln("[INSPECT] " + msg); } catch (_) {} }

  function safeString(val) { return (val === null || val === undefined) ? "" : String(val); }

  function fmtNumber(val) {
    if (typeof val !== "number" || !isFinite(val)) return safeString(val);
    return (Math.round(val * 1000) / 1000).toString();
  }

  function fmtArray(val) {
    if (!val || val.length === undefined) return safeString(val);
    var parts = [];
    for (var i = 0; i < val.length; i++) parts.push(fmtNumber(val[i]));
    return "[" + parts.join(", ") + "]";
  }

  function writeLine(file, text, indent) {
    var prefix = "";
    for (var i = 0; i < indent; i++) prefix += "  ";
    file.writeln(prefix + text);
  }

  function dumpTransforms(file, layer, indent) {
    var group = layer.property("ADBE Transform Group");
    if (!group) return;
    var props = [
      "ADBE Anchor Point", "ADBE Position", "ADBE Scale",
      "ADBE Opacity", "ADBE Rotate Z"
    ];
    writeLine(file, "transform:", indent);
    for (var i = 0; i < props.length; i++) {
      var prop = group.property(props[i]);
      if (!prop) continue;
      try {
        writeLine(file, prop.name + "=" + fmtArray(prop.value), indent + 1);
        if (prop.numKeys > 0) writeLine(file, "keyframes: " + prop.numKeys, indent + 2);
      } catch (_) {}
    }
  }

  function dumpEffects(file, layer, indent) {
    var parade = layer.property("ADBE Effect Parade");
    if (!parade || parade.numProperties < 1) return;
    writeLine(file, "effects: " + parade.numProperties, indent);
    for (var i = 1; i <= parade.numProperties; i++) {
      var effect = parade.property(i);
      writeLine(file, effect.name + " (" + effect.matchName + ") enabled=" + effect.enabled, indent + 1);
    }
  }

  function dumpText(file, layer, indent) {
    try {
      var textProp = layer.property("Source Text");
      if (!textProp) return;
      var doc = textProp.value;
      writeLine(file, "text=" + safeString(doc.text).substring(0, 80), indent);
      writeLine(file, "font=" + safeString(doc.font) + " size=" + fmtNumber(doc.fontSize), indent);
    } catch (_) {}
  }

  function dumpLayer(file, layer, indent) {
    writeLine(file, "layer " + layer.index + ": " + layer.name, indent);
    writeLine(file, "matchName=" + safeString(layer.matchName), indent + 1);
    writeLine(file, "enabled=" + layer.enabled, indent + 1);
    writeLine(file, "in=" + fmtNumber(layer.inPoint) + " out=" + fmtNumber(layer.outPoint), indent + 1);
    if (layer.source) {
      writeLine(file, "source=" + safeString(layer.source.name), indent + 1);
      if (layer.source instanceof CompItem) {
        writeLine(file, "sourceType=Composition (" + layer.source.numLayers + " layers)", indent + 1);
      }
    }
    if (layer.matchName === "ADBE Text Layer") dumpText(file, layer, indent + 1);
    dumpEffects(file, layer, indent + 1);
    dumpTransforms(file, layer, indent + 1);
  }

  function dumpComp(file, comp, indent, recursive) {
    writeLine(file, "comp: " + comp.name, indent);
    writeLine(file, "size=" + comp.width + "x" + comp.height, indent + 1);
    writeLine(file, "duration=" + fmtNumber(comp.duration), indent + 1);
    writeLine(file, "frameRate=" + fmtNumber(comp.frameRate), indent + 1);
    writeLine(file, "layers=" + comp.numLayers, indent + 1);
    for (var i = 1; i <= comp.numLayers; i++) {
      dumpLayer(file, comp.layer(i), indent + 1);
    }
    // Recurse into sub-comp layers
    if (recursive) {
      for (var j = 1; j <= comp.numLayers; j++) {
        var layer = comp.layer(j);
        if (layer.source && layer.source instanceof CompItem && layer.source.name.indexOf("GEN_") === 0) {
          writeLine(file, "", indent);
          writeLine(file, "--- Sub-comp: " + layer.source.name + " ---", indent);
          dumpComp(file, layer.source, indent + 1, false);
        }
      }
    }
  }

  // Main
  app.beginSuppressDialogs();
  try {
    var masterComp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem && item.name === MASTER_COMP_NAME) {
        masterComp = item;
        break;
      }
    }

    if (!masterComp) {
      alert("Master comp not found: " + MASTER_COMP_NAME);
      return;
    }

    var outFile = new File(outputPath);
    outFile.encoding = "UTF-8";
    outFile.open("w");

    writeLine(outFile, "Verification Report", 0);
    writeLine(outFile, "Generated: " + new Date().toString(), 0);
    writeLine(outFile, "Project: " + (app.project.file ? app.project.file.fsName : "<unsaved>"), 0);
    writeLine(outFile, "", 0);
    writeLine(outFile, "=== MASTER COMP ===", 0);
    dumpComp(outFile, masterComp, 0, true);

    outFile.close();
    log("Report written to: " + outputPath);
    alert("Verification report saved to:\\n" + outputPath);
  } catch (err) {
    alert("Inspection failed: " + err.toString());
  }
  app.endSuppressDialogs(false);
})();
`;
}

/**
 * Generate the QA frame export JSX script.
 * When run in AE, it exports PNG frames at the midpoint of each scene layer.
 */
export function generateQaFrameExportJsx(masterCompName: string): string {
  return `(function () {
  var MASTER_COMP_NAME = ${JSON.stringify(masterCompName)};
  var scriptFile = new File($.fileName);
  var outputDir = scriptFile.parent.fsName + "/qa_frames";

  function log(msg) { try { $.writeln("[QA] " + msg); } catch (_) {} }

  // Ensure output directory exists
  var outputFolder = new Folder(outputDir);
  if (!outputFolder.exists) outputFolder.create();

  app.beginSuppressDialogs();
  try {
    var masterComp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem && item.name === MASTER_COMP_NAME) {
        masterComp = item;
        break;
      }
    }

    if (!masterComp) {
      alert("Master comp not found: " + MASTER_COMP_NAME);
      return;
    }

    // Find scene layers (sub-comps starting with GEN_)
    var sceneLayers = [];
    for (var j = 1; j <= masterComp.numLayers; j++) {
      var layer = masterComp.layer(j);
      if (layer.source && layer.source instanceof CompItem && layer.source.name.indexOf("GEN_") === 0) {
        sceneLayers.push({
          index: j,
          name: layer.source.name,
          inPoint: layer.inPoint,
          outPoint: layer.outPoint,
          midPoint: (layer.inPoint + layer.outPoint) / 2
        });
      }
    }

    if (sceneLayers.length === 0) {
      alert("No GEN_ scene layers found in master comp.");
      return;
    }

    // Add master comp to render queue for each midpoint
    var exportedCount = 0;
    for (var k = 0; k < sceneLayers.length; k++) {
      var scene = sceneLayers[k];
      var outFileName = outputDir + "/frame_" + String(k + 1).replace(/^(\\d)$/, "0$1") + "_" + scene.name + ".png";
      var outFile = new File(outFileName);

      try {
        // Save a single frame using saveFrameToPng
        masterComp.time = scene.midPoint;
        var rqItem = app.project.renderQueue.items.add(masterComp);
        var om = rqItem.outputModule(1);
        om.file = outFile;

        // Set to PNG sequence, single frame
        try {
          om.applyTemplate("_HIDDEN X-Factor 8 Premul");
        } catch (_) {
          try { om.applyTemplate("Lossless"); } catch (_2) {}
        }

        rqItem.timeSpanStart = scene.midPoint;
        rqItem.timeSpanDuration = 1 / masterComp.frameRate;
        exportedCount++;
      } catch (renderErr) {
        log("Failed to queue frame for " + scene.name + ": " + renderErr.toString());
      }
    }

    if (exportedCount > 0) {
      app.project.renderQueue.render();
      alert("Exported " + exportedCount + " QA frames to:\\n" + outputDir);
    } else {
      alert("No frames could be queued for export.");
    }

  } catch (err) {
    alert("QA frame export failed: " + err.toString());
  }
  app.endSuppressDialogs(false);
})();
`;
}
