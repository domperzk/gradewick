import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const START_URL = "https://warwick.ac.uk/study/undergraduate/courses/";
const OUT_DIR = path.join(__dirname, "data");
const FINAL_PATH = path.join(OUT_DIR, "warwick-courses-2026.json");

function emptyYears() {
  return {
    "Year 1": { core: [] }, "Year 2": { core: [] }, "Year 3": { core: [] },
    "Year 4": { core: [] }, "Year 5": { core: [] },
    "Intermediate Year": { core: [] }, "Final Year": { core: [] }
  };
}

function clean(text) {
  return (text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function acceptCookies(page) {
  const candidates = [
    page.getByRole("button", { name: /accept all/i }),
    page.getByText(/accept all/i)
  ];
  for (const locator of candidates) {
    try {
      if (await locator.count()) {
        await locator.first().click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        return;
      }
    } catch {}
  }
}

async function loadAllCourses(page) {
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await acceptCookies(page);

  console.log("Expanding course list...");
  while (true) {
    const loadMore = page.locator('text=/load more/i').first();
    try {
      if (!(await loadMore.count())) break;
      const before = await page.locator('a[href*="/study/undergraduate/courses/"]').count();
      await loadMore.scrollIntoViewIfNeeded().catch(() => {});
      await loadMore.click({ timeout: 4000 });
      await page.waitForTimeout(1800);
      await page.waitForFunction(
        (prev) => document.querySelectorAll('a[href*="/study/undergraduate/courses/"]').length > prev,
        before,
        { timeout: 5000 }
      ).catch(() => {});
    } catch { break; }
  }

  const links = await page.$$eval("a[href]", (anchors) =>
    anchors.map((a) => a.href).filter((href) => {
      if (!href) return false;
      const u = href.toLowerCase();
      return u.startsWith("https://warwick.ac.uk/study/undergraduate/courses/") &&
             !u.endsWith("/courses/") && !u.includes("#") && !u.includes("?") &&
             !u.includes("/search") && !u.includes("/filters");
    })
  );

  return [...new Set(links)].filter((u) => !u.endsWith("/ba-classics-part-time/")).sort();
}

async function scrapeCourse(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lines = bodyText.split(/\n+/).map(clean).filter(Boolean);
  const readField = (label) => {
    const idx = lines.findIndex((x) => x === label);
    return idx >= 0 ? clean(lines[idx + 1] || "") : "";
  };

  const h1 = clean(await page.locator("h1").first().textContent().catch(() => ""));
  const meta = {
    course: h1 || clean(await page.title().catch(() => "")) || url,
    url,
    department: readField("Department") || readField("Led by") || "University of Warwick",
    qualification: readField("Qualification") || "Bachelor's Degree",
    duration: readField("Duration") || "3 years full-time"
  };

  // Click modules tab
  try {
    const modTab = page.locator('text=/^modules$/i').first();
    if (await modTab.count()) await modTab.click({ timeout: 2000 });
  } catch {}
  await page.waitForTimeout(1000);

  // Extract the DOM structures using your robust logic
  const years = await page.evaluate(() => {
    function cleanText(s) { return (s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
    function getYearLabel(text) {
      const low = cleanText(text).toLowerCase();
      if (/\byear\s*1\b|\byear one\b|\bfirst year\b/.test(low)) return "Year 1";
      if (/\byear\s*2\b|\byear two\b|\bsecond year\b/.test(low)) return "Year 2";
      if (/\byear\s*3\b|\byear three\b|\bthird year\b/.test(low)) return "Year 3";
      if (/\byear\s*4\b|\byear four\b|\bfourth year\b/.test(low)) return "Year 4";
      if (low.includes("intermediate year")) return "Intermediate Year";
      if (low.includes("final year")) return "Final Year";
      return null;
    }

    const out = {
      "Year 1": { core: [] }, "Year 2": { core: [] }, "Year 3": { core: [] },
      "Year 4": { core: [] }, "Year 5": { core: [] },
      "Intermediate Year": { core: [] }, "Final Year": { core: [] }
    };

    const coreLists = Array.from(document.querySelectorAll('.marketing-module-list[data-module-type="core"]'));
    for (const list of coreLists) {
      let y = "Year 1";
      let prev = list.parentElement.previousElementSibling;
      while (prev) {
        const foundY = getYearLabel(prev.innerText);
        if (foundY) { y = foundY; break; }
        prev = prev.previousElementSibling;
      }
      
      const items = list.parentElement.querySelectorAll('marketing-module, .marketing-module');
      for (const item of items) {
        let code = (item.getAttribute('data-module-code') || "").split('-')[0].toUpperCase();
        let titleEl = item.querySelector('.module--title');
        let name = titleEl ? cleanText(titleEl.textContent).replace(/\([A-Z]{2,4}\d{2,4}.*\)/i, '').replace(/Link opens in a new window/i, '').trim() : "";
        let catsEl = item.querySelector('.module--cats');
        let credits = catsEl ? parseInt(cleanText(catsEl.textContent)) : 15;
        
        if (!code && name) {
          let m = name.match(/\b([A-Z]{2,4}\d{2,4})\b/);
          if (m) code = m[1].toUpperCase();
        }

        if (code && name && !out[y].core.find(c => c.code === code)) {
          out[y].core.push({ name, code, credits });
        }
      }
    }
    return out;
  });

  return { ...meta, years };
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("Loading comprehensive course list...");
    const courseLinks = await loadAllCourses(page);
    console.log(`✅ Found ${courseLinks.length} courses to scrape.`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const results = [];

    for (let i = 0; i < courseLinks.length; i++) {
      console.log(`\n[${i + 1}/${courseLinks.length}] Scraping: ${courseLinks[i]}`);
      try {
        const item = await scrapeCourse(page, courseLinks[i]);
        results.push(item);
        console.log(`   → ${item.course}`);
      } catch (err) {
        console.error(`❌ Failed on ${courseLinks[i]}:`, err.message);
      }
    }

    fs.writeFileSync(FINAL_PATH, JSON.stringify(results, null, 2));
    console.log(`\n🎉 Saved structured courses to ${FINAL_PATH}`);
  } finally {
    await browser.close();
  }
})();