import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// We read and fix the live JS files directly
const MODULES_FILE = path.join(__dirname, '../module-data.js');
const COURSES_FILE = path.join(__dirname, '../course-data.js');

// EXACT MATCHES ONLY. It will never accidentally delete a real assessment.
const EXACT_FAKES = [
  "school of engineering", "wmg", "computer science", "statistics",
  "physics", "chemistry", "economics", "philosophy",
  "politics & international studies", "school of law",
  "warwick business school", "life sciences", "warwick medical school",
  "wms, biomedical sciences", "english and comparative literary studies",
  "school of modern languages and cultures", "sociology",
  "history", "applied linguistics", "psychology",
  "institute for advanced teaching and learning",
  "mathematics", "warwick mathematics institute"
];

function fixAssessment(assessment) {
  if (!assessment || !assessment.components) return assessment;
  
  // 1. Delete ONLY if the component name exactly matches the fake department list
  assessment.components = assessment.components.filter(c => 
    !EXACT_FAKES.includes(c.name.toLowerCase().trim())
  );
  
  // 2. Check the math of what is left
  let sum = assessment.components.reduce((acc, c) => acc + c.weighting, 0);
  let roundedSum = Math.round(sum * 10) / 10;
  
  // 3. If Warwick's own data is genuinely broken (e.g. adds to 160%), wipe it so the user can enter it manually
  if (roundedSum !== 100 && assessment.components.length > 0) {
    assessment.ok = false;
    assessment.components = [];
  }
  
  return assessment;
}

try {
  console.log('🧹 Running EXACT-MATCH cleanup on compiled JS files...');

  // Fix Modules
  let rawMods = fs.readFileSync(MODULES_FILE, 'utf-8');
  let modJson = JSON.parse(rawMods.replace('const WARWICK_ALL_MODULES = ', '').replace(/;\s*$/, ''));
  
  modJson.forEach(mod => { 
    mod.assessment = fixAssessment(mod.assessment); 
  });
  
  fs.writeFileSync(MODULES_FILE, `const WARWICK_ALL_MODULES = ${JSON.stringify(modJson, null, 2)};\n`, 'utf-8');

  // Fix Courses
  let rawCourses = fs.readFileSync(COURSES_FILE, 'utf-8');
  let courseJson = JSON.parse(rawCourses.replace('const WARWICK_COURSES = ', '').replace(/;\s*$/, ''));
  
  courseJson.forEach(course => {
    Object.values(course.years || {}).forEach(year => {
      (year.core || []).forEach(coreMod => {
        coreMod.assessment = fixAssessment(coreMod.assessment);
      });
    });
  });
  
  fs.writeFileSync(COURSES_FILE, `const WARWICK_COURSES = ${JSON.stringify(courseJson, null, 2)};\n`, 'utf-8');

  console.log('✅ Successfully purged department names and saved clean .js files!');
} catch (err) {
  console.error('❌ Error:', err.message);
}