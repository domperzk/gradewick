import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL =
  "https://courses.warwick.ac.uk/?keywords=&departments=RS&departments=CX&departments=DI&departments=EN&departments=GD&departments=HI&departments=IP&departments=LP&departments=HA&departments=TH&departments=CW&departments=FI&departments=LN&departments=CH&departments=CS&departments=LF&departments=PX&departments=PS&departments=ES&departments=ST&departments=WM&departments=MA&departments=MS&departments=ET&departments=IM&departments=CE&departments=EP&departments=EC&departments=EQ&departments=PH&departments=PO&departments=LA&departments=SO&departments=IB&departments=IL&departments=FP&departments=DC&academicYears=2026&page=";

const MAX_PAGE = 70;
const DELAY_MS = 600; 
const OUT_DIR = path.join(__dirname, "data");
const WIP_PATH = path.join(OUT_DIR, "warwick-deep-modules-WIP.json");
const FINAL_PATH = path.join(OUT_DIR, "warwick-deep-modules.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (str) => (str || "").replace(/\s+/g, " ").trim();

function emptyYears() {
  return {
    "Year 1": { core: [] }, "Year 2": { core: [] }, "Year 3": { core: [] },
    "Year 4": { core: [] }, "Year 5": { core: [] }, "Intermediate Year": { core: [] },
    "Final Year": { core: [] }
  };
}

async function getModuleLinks(page) {
  const url = BASE_URL + page;
  let html;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "WarwickFixer/3.0" }, timeout: 15000 });
    if (!res.ok) return [];
    html = await res.text();
  } catch (err) { return []; }

  const $ = cheerio.load(html);
  const links = [];

  $("tbody.search-result-table-body tr.module").each((_, row) => {
    const cells = $(row).find("td");
    const codeRaw = clean($(cells[0]).text());
    const codeMatch = codeRaw.match(/^([A-Z0-9\-]+)\s*\(/);
    const code = codeMatch ? codeMatch[1] : codeRaw;
    const relHref = $(cells[0]).find("a").attr("href") || "";
    const fullUrl = relHref ? `https://courses.warwick.ac.uk${relHref}` : "";
    const name = clean($(cells[1]).text());
    const department = clean($(cells[3]).text());
    const shallowAssessment = clean($(cells[4]).text());

    if (code && fullUrl) {
      links.push({ code, name, department, url: fullUrl, shallowAssessment });
    }
  });

  return links;
}

async function scrapeDeepModulePage(moduleObj) {
  let html;
  try {
    const res = await fetch(moduleObj.url, { headers: { "User-Agent": "WarwickFixer/3.0" }, timeout: 15000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) { return null; }

  const $ = cheerio.load(html);
  const bodyText = $("body").text() || "";

  let cats = 15; 
  const catsMatch = bodyText.match(/\b(\d{1,3})\s*CATS\b/i) || bodyText.match(/Credits?:\s*(\d{1,3})/i);
  if (catsMatch) cats = parseInt(catsMatch[1], 10);

  const components = [];
  
  // Try official ID first
  let targetTables = $('table[id^="module-assessment-"]');
  
  // Fallback if IDs are missing (Explicitly ignores the Department Subject Split tables)
  if (targetTables.length === 0) {
    targetTables = $('table').filter((i, el) => {
      const text = $(el).text().toLowerCase();
      return text.includes("weighting") && text.includes("%") && 
             !text.includes("private study") && 
             !text.includes("subject split") && 
             !text.includes("proportion");
    });
  }

  targetTables.each((i, table) => {
    // CRUCIAL FIX: Search for 'tr' directly, bypassing the missing 'tbody' bug
    $(table).find("tr").each((j, row) => {
      const cells = [];
      $(row).find("td, th").each((_, cell) => cells.push(clean($(cell).text())));
      
      if (cells.length < 2) return;
      
      const rowText = cells.join(" ").toLowerCase();
      
      // Skip headers and bad rows
      if (rowText.includes("weighting") && rowText.includes("study time")) return;
      if (rowText.includes("answerbook")) return;

      // Find which column has the percentage (handles column swapping)
      const weightIdx = cells.findIndex(c => /\d+(?:\.\d+)?\s*%/.test(c));
      if (weightIdx === -1) return;

      let name = cells[0];
      if (/^\d+(?:\.\d+)?\s*%$/.test(name)) name = cells[1];

      const weightMatch = cells[weightIdx].match(/(\d+(?:\.\d+)?)\s*%/);
      
      if (name && weightMatch && !name.toLowerCase().includes("total")) {
        const cleanName = name.replace(/^(re)?assessment component$/i, '').trim();
        if (cleanName) {
          components.push({
            name: cleanName,
            weighting: parseFloat(weightMatch[1])
          });
        }
      }
    });
  });

  // Deduplicate
  const uniqueComps = [];
  const seenNames = new Set();
  for (const c of components) {
    const key = `${c.name}-${c.weighting}`;
    if (!seenNames.has(key)) {
      seenNames.add(key);
      uniqueComps.push(c);
    }
  }

  return {
    course: moduleObj.name,
    url: moduleObj.url,
    department: moduleObj.department,
    qualification: "Module",
    duration: null,
    ucas: null,
    code: moduleObj.code,
    credits: cats,
    assessment: {
      ok: uniqueComps.length > 0,
      assessmentSplit: moduleObj.shallowAssessment,
      components: uniqueComps
    },
    years: emptyYears()
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("🚀 Phase 1: Gathering module URLs (2026)...");
  let allLinks = [];
  for (let page = 0; page <= MAX_PAGE; page++) {
    const links = await getModuleLinks(page);
    if (links.length === 0) break;
    allLinks.push(...links);
    process.stdout.write(`\rFound ${allLinks.length} modules...`);
    await sleep(400);
  }
  
  const uniqueLinks = Array.from(new Map(allLinks.map(item => [item.code, item])).values());
  console.log(`\n✅ Starting deep scrape on ${uniqueLinks.length} modules...`);

  const deepModules = [];

  for (let i = 0; i < uniqueLinks.length; i++) {
    const linkObj = uniqueLinks[i];
    const deepData = await scrapeDeepModulePage(linkObj);

    if (deepData) {
      deepModules.push(deepData);
      if (i % 10 === 0) fs.writeFileSync(WIP_PATH, JSON.stringify(deepModules, null, 2));
    }

    const pct = (((i + 1) / uniqueLinks.length) * 100).toFixed(1);
    const compStr = deepData && deepData.assessment.ok ? deepData.assessment.components.map(c => `${c.name}: ${c.weighting}%`).join(', ') : 'Failed / 0 Components';
    console.log(`[${i + 1}/${uniqueLinks.length}] (${pct}%) ${linkObj.code} -> ${compStr}`);
    
    await sleep(DELAY_MS); 
  }

  fs.writeFileSync(FINAL_PATH, JSON.stringify(deepModules, null, 2));
  console.log(`\n🎉 DONE! Saved perfect assessments to ${FINAL_PATH}`);
})();