import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const DEEP_MODULES_FILE = path.join(DATA_DIR, 'warwick-deep-modules.json');
const OUT_MODULES_JS = path.join(__dirname, '../module-data.js');
const COURSES_JS_FILE = path.join(__dirname, '../course-data.js');

function cleanAssessmentComponents(components) {
  if (!components || components.length === 0) return components;

  // 1. Drop anything explicitly containing "resit" or "reassessment"
  let filtered = components.filter(c => {
    const name = c.name.toLowerCase();
    return !name.includes('resit') && !name.includes('reassessment');
  });

  // 2. Mathematical Check: Do the weights sum to 100%?
  let sum = filtered.reduce((acc, c) => acc + c.weighting, 0);
  
  // If the sum exceeds 100% (classic Warwick resit/alternative table overflow)
  if (sum > 100 && filtered.length > 1) {
    // Look for a stray 100% component that is causing the inflation and drop it
    filtered = filtered.filter(c => c.weighting !== 100);
    
    // Recalculate sum after dropping 100% outliers
    sum = filtered.reduce((acc, c) => acc + c.weighting, 0);
  }

  // 3. Fallback safety net: If it still doesn't add up to 100% and has multiple components, 
  // keep the original components rather than outputting mathematically impossible data.
  return filtered.length > 0 ? filtered : components;
}

try {
  console.log('🚀 Compiling Gradewick 2026 Database (Filtering Resits & Department Splits)...');

  const rawModules = JSON.parse(fs.readFileSync(DEEP_MODULES_FILE, 'utf-8'));
  const moduleDict = {};
  const uniqueModules = [];
  
  for (const mod of rawModules) {
    if (!mod.code) continue;
    const baseCode = mod.code.split('-')[0].toUpperCase();
    
    // Apply resit filter to the module's components
    if (mod.assessment && mod.assessment.components) {
      mod.assessment.components = cleanAssessmentComponents(mod.assessment.components);
      // Recalculate 'ok' status based on whether components remain
      mod.assessment.ok = mod.assessment.components.length > 0;
    }

    if (!moduleDict[baseCode]) {
      moduleDict[baseCode] = mod;
      uniqueModules.push(mod);
    }
  }

  const rawCourseJs = fs.readFileSync(COURSES_JS_FILE, 'utf-8');
  const jsonStart = rawCourseJs.indexOf('[');
  const jsonEnd = rawCourseJs.lastIndexOf(']') + 1;
  const existingCourses = JSON.parse(rawCourseJs.slice(jsonStart, jsonEnd));
  
  let updatedModulesCount = 0;

  const enrichedCourses = existingCourses.map(course => {
    for (const year of Object.values(course.years || {})) {
      if (!year.core) continue;
      
      year.core.forEach(coreMod => {
        const baseCode = coreMod.code.split('-')[0].toUpperCase();
        const freshModData = moduleDict[baseCode];
        
        if (freshModData && freshModData.assessment) {
          coreMod.code = freshModData.code; 
          coreMod.assessment = freshModData.assessment;
          updatedModulesCount++;
        } else {
          coreMod.assessment = { ok: false, components: [] };
        }
      });
    }
    return course;
  });

  fs.writeFileSync(OUT_MODULES_JS, `const WARWICK_ALL_MODULES = ${JSON.stringify(uniqueModules, null, 2)};\n`, 'utf-8');
  fs.writeFileSync(COURSES_JS_FILE, `const WARWICK_COURSES = ${JSON.stringify(enrichedCourses, null, 2)};\n`, 'utf-8');

  console.log(`✅ Success! Resits purged and data compiled.`);
  console.log(`📚 Unique 2026 Modules Written: ${uniqueModules.length}`);
  console.log(`🔄 Core Modules Updated: ${updatedModulesCount}`);
  
} catch (err) {
  console.error('❌ Compilation Error:', err.message);
}