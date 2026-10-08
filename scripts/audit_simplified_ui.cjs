const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log('Navigating to consultation page...');
  await page.goto('http://localhost:3001/consultation/3728a50f-15cd-4cd6-a29b-4b177b79d012', { waitUntil: 'networkidle' });

  // 1. Capture Synthese Top view
  await page.screenshot({ path: 'scratch_roihini/audit_synthese_simplified.png' });
  console.log('Captured audit_synthese_simplified.png');

  // 2. Scroll down to see the dropdown accordions
  await page.evaluate(() => window.scrollBy(0, 1100));
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'scratch_roihini/audit_synthese_dropdowns.png' });
  console.log('Captured audit_synthese_dropdowns.png');

  // 3. Click first dropdown to open it
  const firstSummary = await page.$('details summary');
  if (firstSummary) {
    await firstSummary.click();
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: 'scratch_roihini/audit_synthese_dropdown_opened.png' });
    console.log('Captured audit_synthese_dropdown_opened.png');
  }

  // 4. Navigate to "Résumé Rapide" tab
  const resumeTab = await page.locator('text=Résumé Rapide').first();
  if (await resumeTab.isVisible()) {
    await resumeTab.click();
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'scratch_roihini/audit_resume_tab.png' });
    console.log('Captured audit_resume_tab.png');
  }

  await browser.close();
  console.log('All screenshots taken!');
}

main().catch(console.error);
