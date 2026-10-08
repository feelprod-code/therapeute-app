const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3001/consultation/30369bad-af29-421f-8872-413eb55e1832', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Find the "Doc" button in the mobile header
  const docButton = page.locator('button:has-text("Doc")').first();
  console.log("Clicking Doc button...");
  await docButton.click();
  await page.waitForTimeout(500);

  console.log("Waiting for dropdown content...");
  const bilanOption = page.locator('text=Mettre à jour le Bilan').first();
  console.log("Is bilanOption visible?", await bilanOption.isVisible());

  // Listen for filechooser
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 3000 }).catch(e => {
    console.log("FileChooser TIMEOUT or NOT TRIGGERED:", e.message);
    return null;
  });

  console.log("Clicking 'Mettre à jour le Bilan'...");
  await bilanOption.click();

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    console.log("SUCCESS! FileChooser was triggered!");
  } else {
    console.log("FAILED! FileChooser was NOT triggered!");
  }

  await browser.close();
}

main().catch(console.error);
