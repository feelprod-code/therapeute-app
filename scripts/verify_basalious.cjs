const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });

  const page = await context.newPage();
  
  console.log("Navigating to Basalious consultation on iPhone...");
  await page.goto('http://localhost:3001/consultation/3728a50f-15cd-4cd6-a29b-4b177b79d012', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Scroll down to see the imaging and folded document
  await page.evaluate(() => window.scrollBy(0, 700));
  await page.waitForTimeout(500);

  const shot1Path = path.join('/tmp', 'iphone_basalious_imaging.png');
  await page.screenshot({ path: shot1Path, fullPage: false });
  console.log("Saved screenshot to", shot1Path);

  // Check Suivi tab
  const suiviTab = page.locator('button[data-state]:has-text("Suivi")').first();
  if (await suiviTab.isVisible()) {
    await suiviTab.click();
    await page.waitForTimeout(1000);
    const shot2Path = path.join('/tmp', 'iphone_basalious_suivi.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    console.log("Saved suivi screenshot to", shot2Path);
  }

  await browser.close();
}

main().catch(console.error);
