const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3001/consultation/3728a50f-15cd-4cd6-a29b-4b177b79d012', { waitUntil: 'networkidle' });

  const resumeTab = await page.locator('text=Résumé Rapide').first();
  if (await resumeTab.isVisible()) {
    await resumeTab.click();
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => window.scrollBy(0, 900));
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: 'scratch_roihini/audit_vignettes_resume_bottom.png' });
    console.log('Captured audit_vignettes_resume_bottom.png');
  }

  await browser.close();
}

main().catch(console.error);
