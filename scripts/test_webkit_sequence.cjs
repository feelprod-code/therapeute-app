const { webkit } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function main() {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('http://localhost:3001/consultation/30369bad-af29-421f-8872-413eb55e1832', { waitUntil: 'networkidle' });

  // Open Doc menu
  await page.locator('button:has-text("Doc")').first().click();
  await page.waitForTimeout(500);

  const option = page.locator('text=Mettre à jour le Bilan').first();
  const box = await option.boundingBox();
  console.log("WebKit Option bounding box:", box);

  let fileChooserFired = false;
  page.on('filechooser', () => {
    fileChooserFired = true;
    console.log("EVENT: filechooser fired in WebKit!");
  });

  console.log("Dispatching real mouse click at coordinates in WebKit:", box.x + 20, box.y + 10);
  await page.mouse.click(box.x + 20, box.y + 10);
  await page.waitForTimeout(1000);

  console.log("Did filechooser fire in WebKit?", fileChooserFired);

  // Also test touch tap
  if (!fileChooserFired) {
    console.log("Testing touch tap...");
    await page.touchscreen.tap(box.x + 20, box.y + 10);
    await page.waitForTimeout(1000);
    console.log("Did filechooser fire after touch tap?", fileChooserFired);
  }

  await browser.close();
}

main().catch(console.error);
