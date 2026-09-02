import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The exact name of your uploaded CSV file
const CSV_FILE = path.join(__dirname, 'exjun26_final-2 - EXJUN26.csv');
const OUTPUT_FILE = path.join(__dirname, 'exam-data.js');

// Simple CSV parser to handle quotes containing commas
function parseCSVLine(text) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && text[i + 1] === '"') {
      current += '"'; i++; // escaped quote
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

try {
  console.log('📖 Reading exam timetable CSV...');
  const rawCSV = fs.readFileSync(CSV_FILE, 'utf-8');
  
  // Split into lines and clean up carriage returns
  const lines = rawCSV.replace(/\r/g, '').split('\n');
  
  const EXAM_TIMETABLE = {};
  let dataStarted = false;
  let resitsSkipped = 0;
  let examsAdded = 0;

  lines.forEach(line => {
    if (!line.trim()) return;
    
    const cols = parseCSVLine(line);
    
    // Wait until we hit the header row to start parsing data
    if (cols[0] === 'Module Code') {
      dataStarted = true;
      return;
    }
    
    if (!dataStarted || cols.length < 9) return;

    const rawCode = cols[0].trim();       
    const rawTitle = cols[2].trim();      // Grab the paper title
    const rawDate = cols[4].trim();       
    const rawTime = cols[5].trim();       
    const rawDuration = cols[6].trim();   
    const rawVenue = cols[8].trim();      

    if (!rawCode) return;

    // 🚨 THE RESIT FILTER 🚨
    // If the title contains "resit" (ignoring uppercase/lowercase), skip it immediately.
    if (rawTitle.toLowerCase().includes('resit')) {
      resitsSkipped++;
      return;
    }

    // 1. Format Date to YYYY-MM-DD
    let formattedDate = "";
    if (rawDate.includes('/')) {
      const parts = rawDate.split('/');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
      }
    }

    // 2. Format Duration to "Xh Ym"
    let formattedDuration = rawDuration;
    if (rawDuration.includes(':')) {
      const [hours, mins] = rawDuration.split(':');
      formattedDuration = `${parseInt(hours, 10)}h ${parseInt(mins, 10)}m`;
      if (formattedDuration === '0h 0m') formattedDuration = ''; 
    }

    const examData = {
      date: formattedDate,
      time: rawTime,
      duration: formattedDuration,
      location: rawVenue
    };

    // 3. The "Hyphen Rule" - Save both versions
    // Saves "CS118-15"
    EXAM_TIMETABLE[rawCode] = examData;
    examsAdded++;
    
    // Saves the base "CS118"
    if (rawCode.includes('-')) {
      const baseCode = rawCode.split('-')[0];
      EXAM_TIMETABLE[baseCode] = examData; 
      examsAdded++;
    }
  });

  // Write out the JS dictionary file
  const jsContent = `const EXAM_TIMETABLE = ${JSON.stringify(EXAM_TIMETABLE, null, 2)};\n`;
  fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf-8');

  console.log(`✅ Success! Parsed exams and saved to exam-data.js`);
  console.log(`📊 Total exam codes added: ${examsAdded}`);
  console.log(`🗑️ Successfully skipped ${resitsSkipped} resit exams.`);
  
} catch (err) {
  console.error('❌ Error:', err.message);
}