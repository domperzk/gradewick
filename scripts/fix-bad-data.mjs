import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'warwick-deep-modules.json');

// Words that indicate a department
const DEPT_KEYWORDS = [
  "school", "wmg", "warwick", "sciences", "physics",
  "chemistry", "computer science", "statistics", "economics",
  "philosophy", "politics", "psychology", "sociology", "history",
  "biomedical", "institute", "department", "language", "english",
  "mathematics", "mathematical", "law"
];

// Words that indicate a REAL assessment
const SAFE_WORDS = [
  "exam", "test", "report", "essay", "project", "portfolio", 
  "coursework", "assignment", "presentation", "quiz", "viva", 
  "lab", "practical", "dissertation", "exercise", "review"
];

function isFakeDepartmentComponent(name) {
  const lower = name.toLowerCase();
  const hasDeptWord = DEPT_KEYWORDS.some(k => lower.includes(k));
  const hasSafeWord = SAFE_WORDS.some(k => lower.includes(k));
  
  // If it sounds like a department AND doesn't have an assessment word, it's fake.
  // (e.g., "Computer Science" = fake. "Computer Science Project" = real).
  return hasDeptWord && !hasSafeWord;
}

try {
  console.log('🧹 Auditing database for department names and broken math...');
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  
  let deptFixedCount = 0;
  let mathFailedCount = 0;

  data.forEach(mod => {
    if (!mod.assessment || !mod.assessment.components) return;

    const originalLen = mod.assessment.components.length;
    
    // 1. Filter out the fake department components
    mod.assessment.components = mod.assessment.components.filter(c => !isFakeDepartmentComponent(c.name));
    
    if (mod.assessment.components.length !== originalLen) {
      deptFixedCount++;
    }

    // 2. Check if the remaining components sum to exactly 100
    const sum = mod.assessment.components.reduce((acc, c) => acc + c.weighting, 0);
    
    // Sometimes JavaScript math gets weird with decimals (e.g., 99.999999), so we round it
    const roundedSum = Math.round(sum * 10) / 10;
    
    if (roundedSum !== 100 && mod.assessment.components.length > 0) {
      // If it still doesn't equal 100 after cleanup, the data is just broken.
      // We invalidate the assessment so the user can just enter it manually.
      mod.assessment.ok = false;
      mod.assessment.components = [];
      mathFailedCount++;
    }
  });

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`\n✅ Cleaned up ${deptFixedCount} modules containing fake department splits.`);
  console.log(`🗑️ Erased ${mathFailedCount} modules where the math didn't sum to 100%.\n`);
  
} catch (err) {
  console.error('❌ Error during cleanup:', err);
}