const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function testDesktop() {
  console.log("\n--- TESTING DESKTOP ---");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3001/consultation/30369bad-af29-421f-8872-413eb55e1832', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. Test Bilan card button
  console.log("Testing Bilan card 'Sélectionner document(s)' button...");
  let cardFileChooser = false;
  page.once('filechooser', () => { cardFileChooser = true; });
  await page.locator('text=Sélectionner document(s)').first().click();
  await page.waitForTimeout(500);
  console.log("Card button triggered filechooser?", cardFileChooser);

  // 2. Test Desktop sidebar "Ajouter un Document" dropdown
  console.log("Testing Desktop sidebar 'Ajouter un Document'...");
  await page.locator('button:has-text("Ajouter un Document")').click();
  await page.waitForTimeout(500);

  let bilanSidebarFileChooser = false;
  page.once('filechooser', () => { bilanSidebarFileChooser = true; });
  await page.locator('text=Mettre à jour le Bilan').last().click();
  await page.waitForTimeout(500);
  console.log("Sidebar 'Mettre à jour le Bilan' triggered filechooser?", bilanSidebarFileChooser);

  await browser.close();
}

async function testMobile() {
  console.log("\n--- TESTING MOBILE / IPHONE ---");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3001/consultation/30369bad-af29-421f-8872-413eb55e1832', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. Open Doc dropdown
  console.log("Testing Mobile Doc button...");
  await page.locator('button:has-text("Doc")').first().click();
  await page.waitForTimeout(500);

  let mobileBilanChooser = false;
  page.once('filechooser', () => { mobileBilanChooser = true; });
  await page.locator('text=Mettre à jour le Bilan').first().click();
  await page.waitForTimeout(500);
  console.log("Mobile 'Mettre à jour le Bilan' triggered filechooser?", mobileBilanChooser);

  // 2. Test Mobile Suivi option
  await page.locator('button:has-text("Doc")').first().click();
  await page.waitForTimeout(500);

  let mobileSuiviChooser = false;
  page.once('filechooser', () => { mobileSuiviChooser = true; });
  await page.locator('text=Nouvelle Note de Suivi').first().click();
  await page.waitForTimeout(500);
  console.log("Mobile 'Nouvelle Note de Suivi' triggered filechooser?", mobileSuiviChooser);

  // 3. Test Mobile Visuel button
  let mobileVisuelChooser = false;
  page.once('filechooser', () => { mobileVisuelChooser = true; });
  await page.locator('button:has-text("Visuel")').first().click();
  await page.waitForTimeout(500);
  console.log("Mobile 'Visuel' button triggered filechooser?", mobileVisuelChooser);

  await browser.close();
}

async function main() {
  await testDesktop();
  await testMobile();
  console.log("\nALL TESTS COMPLETED!");
}

main().catch(console.error);
