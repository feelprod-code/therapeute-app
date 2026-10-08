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
  
  // 1. Check patient consultation page
  console.log("Navigating to consultation page on iPhone...");
  await page.goto('http://localhost:3001/consultation/30369bad-af29-421f-8872-413eb55e1832', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const shot1Path = path.join('/tmp', 'iphone_consultation_synthese.png');
  await page.screenshot({ path: shot1Path, fullPage: false });
  console.log("Saved screenshot 1 to", shot1Path);

  // 2. Click on Suivi tab
  const suiviTab = page.locator('button[data-state]:has-text("Suivi")').first();
  if (await suiviTab.isVisible()) {
    await suiviTab.click();
    await page.waitForTimeout(1000);
    const shot2Path = path.join('/tmp', 'iphone_consultation_suivi.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    console.log("Saved screenshot 2 to", shot2Path);
  }

  // 3. Check Home page
  console.log("Navigating to home page on iPhone...");
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const shot3Path = path.join('/tmp', 'iphone_home_upload.png');
  await page.screenshot({ path: shot3Path, fullPage: false });
  console.log("Saved screenshot 3 to", shot3Path);

  await browser.close();
  console.log("Verification finished successfully!");
}

main().catch(console.error);
