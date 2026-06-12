const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { JSDOM } = require('jsdom');

async function extractTextFromDocx(path) {
  const result = await mammoth.convertToHtml({ path });
  
  try {
    const dom = new JSDOM(result.value);
    const doc = dom.window.document;
    const tables = Array.from(doc.querySelectorAll('table'));
    
    let structuredText = "";
    let tableParsed = false;
    
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length === 0) continue;
      
      const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map(td => td.textContent?.trim() || "");
      if (headerCells.includes('Audio Cues') && headerCells.includes('Frame')) {
        tableParsed = true;
        structuredText += "### SCRIPT SCENES (Extracted from Table)\n\n";
        
        const getCleanText = (html) => {
          let text = html.replace(/<br\s*\/?>/gi, '\n');
          text = text.replace(/<\/p>/gi, '\n');
          text = text.replace(/<\/li>/gi, '\n');
          text = text.replace(/<\/?[^>]+(>|$)/g, " "); // Replace other tags with space
          text = text.replace(/\n\s+/g, '\n'); // remove leading spaces on new lines
          text = text.replace(/\n+/g, '\n'); // remove double newlines
          const temp = dom.window.document.createElement('div');
          temp.innerHTML = text;
          return temp.textContent?.trim() || "";
        };

        for (let i = 1; i < rows.length; i++) {
          const cols = Array.from(rows[i].querySelectorAll('th, td'));
          if (cols.length >= 3) {
            const audio = getCleanText(cols[0].innerHTML);
            const frame = getCleanText(cols[1].innerHTML);
            const viz = getCleanText(cols[2].innerHTML);
            
            structuredText += `--- SCRIPT SCENE ${i} ---\n`;
            structuredText += `FRAME/LAYOUT: ${frame}\n`;
            structuredText += `AUDIO CUES (Narration/Subtitles):\n${audio}\n`;
            structuredText += `VISUALIZATION / TEXT ON SCREEN:\n${viz}\n\n`;
          }
        }
      }
    }
    
    if (tableParsed) {
      return structuredText;
    }
  } catch (e) {
    console.warn("Could not parse DOCX tables into structured markdown, falling back to raw HTML", e);
  }

  return result.value;
}

extractTextFromDocx(path.join(__dirname, 'fixtures', 'Photosynthesis_Script.docx'))
  .then(console.log)
  .catch(console.error);
