import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const DEEP_MODULES_FILE = path.join(DATA_DIR, 'warwick-deep-modules.json');
const COURSES_FILE = path.join(DATA_DIR, 'warwick-courses-2026.json');

// CHANGED: Outputs directly to the root folder
const OUT_MODULES_JS = path.join(__dirname, '../module-data.js'); 
const OUT_COURSES_JS = path.join(__dirname, '../course-data.js');

try {
  console.log('🚀 Compiling Gradewick 2026 Database...');

  // 1. Load the deep modules and deduplicate them
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

  // 2. Load the scraped courses
  const rawCourses = JSON.parse(fs.readFileSync(COURSES_FILE, 'utf-8'));
  
  // 3. Enrich the courses with the deep module assessments
  const enrichedCourses = rawCourses.map(course => {
    for (const year of Object.values(course.years || {})) {
      if (!year.core) continue;
      
      year.core.forEach(coreMod => {
        const baseCode = coreMod.code.split('-')[0].toUpperCase();
        const fullModData = moduleDict[baseCode];
        
        // If we found it in the master dict, attach the assessment data!
        if (fullModData && fullModData.assessment) {
          // Inject the exact hyphenated code (e.g. CS118 -> CS118-15)
          coreMod.code = fullModData.code; 
          coreMod.assessment = fullModData.assessment;
        } else {
          coreMod.assessment = { ok: false, components: [] };
        }
      });
    }
    return course;
  });

  // 4. Write perfectly formatted JS files
  fs.writeFileSync(OUT_MODULES_JS, `const WARWICK_ALL_MODULES = ${JSON.stringify(uniqueModules, null, 2)};\n`, 'utf-8');
  fs.writeFileSync(OUT_COURSES_JS, `const WARWICK_COURSES = ${JSON.stringify(enrichedCourses, null, 2)};\n`, 'utf-8');

  console.log(`✅ Success! Data perfectly compiled.`);
  console.log(`📚 Unique Modules Written: ${uniqueModules.length}`);
  console.log(`🎓 Structured Courses Written: ${enrichedCourses.length}`);
  
} catch (err) {
  console.error('❌ Compilation Error:', err.message);
}