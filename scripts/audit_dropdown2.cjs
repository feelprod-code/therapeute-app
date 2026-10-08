const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3001/consultation/3728a50f-15cd-4cd6-a29b-4b177b79d012', { waitUntil: 'networkidle' });

  // Scroll to dropdowns
  await page.evaluate(() => window.scrollBy(0, 1500));
  await new Promise(r => setTimeout(r, 400));

  // Open 2nd details
  const summaries = await page.$$('details summary');
  console.log(`Found ${summaries.length} summaries`);
  if (summaries[1]) {
    await summaries[1].click();
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: 'scratch_roihini/audit_dropdown_scanner_opened.png' });
    console.log('Captured audit_dropdown_scanner_opened.png');
  }

  // Scroll a bit more to view the opened content
  await page.evaluate(() => window.scrollBy(0, 400));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: 'scratch_roihini/audit_dropdown_scanner_content.png' });
  console.log('Captured audit_dropdown_scanner_content.png');

  await browser.close();
}

main().catch(console.error);
