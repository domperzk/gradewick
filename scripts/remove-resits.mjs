import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODULES_FILE = path.join(__dirname, '../module-data.js');
const COURSES_FILE = path.join(__dirname, '../course-data.js');

function cleanAssessmentComponents(components) {
  if (!components || !Array.isArray(components) || components.length <= 1) {
    return components;
  }

  // RULE 1: Drop anything explicitly containing "resit" or "reassessment"
  let filtered = components.filter(c => {
    const name = c.name.toLowerCase();
    return !name.includes('resit') && !name.includes('reassessment');
  });

  if (filtered.length <= 1) return filtered.length > 0 ? filtered : components;

  // RULE 2 & 3: Handling 100% weights
  const count100 = filtered.filter(c => c.weighting === 100).length;
  
  if (count100 >= 2) {
    // If there are two (or more) 100% components, keep the first one and drop the rest
    let keptFirst = false;
    filtered = filtered.filter(c => {
      if (c.weighting === 100) {
        if (!keptFirst) {
          keptFirst = true;
          return true;
        }
        return false;
      }
      return true;
    });
  } else if (count100 === 1 && filtered.length > 1) {
    // If there is exactly one 100% component alongside others (e.g., 40, 60, 100), drop the 100%
    filtered = filtered.filter(c => c.weighting !== 100);
  }

  if (filtered.length <= 1) return filtered.length > 0 ? filtered : components;

  // RULE 4: Prefix Sum Check
  // If the components before the final one add up to exactly 100%, drop the final one
  let prefixSum = 0;
  for (let i = 0; i < filtered.length - 1; i++) {
    prefixSum += filtered[i].weighting;
  }
  
  if (Math.round(prefixSum * 10) / 10 === 100) {
    filtered = filtered.slice(0, filtered.length - 1);
  }

  return filtered.length > 0 ? filtered : components;
}

try {
  console.log('Sweeping live JS files for rogue resits and broken math...');

  // 1. Process module-data.js (Bulletproof parsing)
  let rawMods = fs.readFileSync(MODULES_FILE, 'utf-8');
  let modStart = rawMods.indexOf('[');
  let modEnd = rawMods.lastIndexOf(']') + 1;
  let modJson = JSON.parse(rawMods.slice(modStart, modEnd));
  
  let modulesCleaned = 0;
  modJson.forEach(mod => { 
    if (mod.assessment && mod.assessment.components) {
      const startLen = mod.assessment.components.length;
      mod.assessment.components = cleanAssessmentComponents(mod.assessment.components);
      if (mod.assessment.components.length !== startLen) modulesCleaned++;
    }
  });
  
  fs.writeFileSync(MODULES_FILE, `const WARWICK_ALL_MODULES = ${JSON.stringify(modJson, null, 2)};\n`, 'utf-8');

  // 2. Process course-data.js (Bulletproof parsing)
  let rawCourses = fs.readFileSync(COURSES_FILE, 'utf-8');
  let courseStart = rawCourses.indexOf('[');
  let courseEnd = rawCourses.lastIndexOf(']') + 1;
  let courseJson = JSON.parse(rawCourses.slice(courseStart, courseEnd));
  
  let coursesCleaned = 0;
  courseJson.forEach(course => {
    let courseChanged = false;
    Object.values(course.years || {}).forEach(year => {
      (year.core || []).forEach(coreMod => {
        if (coreMod.assessment && coreMod.assessment.components) {
          const startLen = coreMod.assessment.components.length;
          coreMod.assessment.components = cleanAssessmentComponents(coreMod.assessment.components);
          if (coreMod.assessment.components.length !== startLen) courseChanged = true;
        }
      });
    });
    if (courseChanged) coursesCleaned++;
  });
  
  fs.writeFileSync(COURSES_FILE, `const WARWICK_COURSES = ${JSON.stringify(courseJson, null, 2)};\n`, 'utf-8');

  console.log(`Success! Fixed components in ${modulesCleaned} individual modules and ${coursesCleaned} course structures.`);
} catch (err) {
  console.error('Error:', err.message);
}