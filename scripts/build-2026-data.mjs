import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const DEEP_MODULES_FILE = path.join(DATA_DIR, 'warwick-deep-modules.json');
const OUT_MODULES_JS = path.join(__dirname, '../module-data.js');
const COURSES_JS_FILE = path.join(__dirname, '../course-data.js'); // Read and write directly to this

try {
  console.log('🚀 Compiling Gradewick 2026 Database (Injecting into existing courses)...');

  // 1. Load the fresh 2026 deep modules
  const rawModules = JSON.parse(fs.readFileSync(DEEP_MODULES_FILE, 'utf-8'));
  const moduleDict = {};
  const uniqueModules = [];
  
  for (const mod of rawModules) {
    if (!mod.code) continue;
    const baseCode = mod.code.split('-')[0].toUpperCase();
    
    // Store in dictionary for easy lookup later
    if (!moduleDict[baseCode]) {
      moduleDict[baseCode] = mod;
      uniqueModules.push(mod);
    }
  }

  // 2. Read the EXISTING course-data.js from the root folder
  const rawCourseJs = fs.readFileSync(COURSES_JS_FILE, 'utf-8');
  const jsonStart = rawCourseJs.indexOf('[');
  const jsonEnd = rawCourseJs.lastIndexOf(']') + 1;
  const existingCourses = JSON.parse(rawCourseJs.slice(jsonStart, jsonEnd));
  
  let updatedModulesCount = 0;

  // 3. Inject the fresh 2026 assessment data into the existing courses
  const enrichedCourses = existingCourses.map(course => {
    for (const year of Object.values(course.years || {})) {
      if (!year.core) continue;
      
      year.core.forEach(coreMod => {
        const baseCode = coreMod.code.split('-')[0].toUpperCase();
        const freshModData = moduleDict[baseCode];
        
        // If we found it in the fresh 2026 dict, update the assessment data!
        if (freshModData && freshModData.assessment) {
          coreMod.code = freshModData.code; // Sync the exact 2026 hyphenated code
          coreMod.assessment = freshModData.assessment; // Sync the 2026 assessment splits
          updatedModulesCount++;
        } else {
          // If the module no longer exists in 2026, keep it but blank out the assessment
          coreMod.assessment = { ok: false, components: [] };
        }
      });
    }
    return course;
  });

  // 4. Write perfectly formatted JS files back to the root folder
  fs.writeFileSync(OUT_MODULES_JS, `const WARWICK_ALL_MODULES = ${JSON.stringify(uniqueModules, null, 2)};\n`, 'utf-8');
  fs.writeFileSync(COURSES_JS_FILE, `const WARWICK_COURSES = ${JSON.stringify(enrichedCourses, null, 2)};\n`, 'utf-8');

  console.log(`✅ Success! Data perfectly compiled.`);
  console.log(`📚 Unique 2026 Modules Written: ${uniqueModules.length}`);
  console.log(`🎓 Existing Courses Retained: ${enrichedCourses.length}`);
  console.log(`🔄 Core Modules Updated with 2026 Assessments: ${updatedModulesCount}`);
  
} catch (err) {
  console.error('❌ Compilation Error:', err.message);
}