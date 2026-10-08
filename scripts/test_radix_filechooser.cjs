const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <input type="file" id="targetInput" style="display:none" onchange="console.log('INPUT CHANGED')" />
      <div id="dropdownContent" style="padding: 20px; background: #fff; border: 1px solid #ccc; width: 250px;">
        <div id="menuItemBilan" role="menuitem" tabindex="0" style="padding: 10px; cursor: pointer; background: #fafafa; border-radius: 6px;">
          <span>🔄 Mettre à jour le Bilan</span>
        </div>
      </div>
      <script>
        const item = document.getElementById('menuItemBilan');
        const input = document.getElementById('targetInput');
        function triggerUpload() {
          input.value = '';
          input.click();
        }
        item.addEventListener('click', triggerUpload);
      </script>
    </body>
    </html>
  `);

  let fileChooserFired = false;
  page.on('filechooser', () => {
    fileChooserFired = true;
    console.log("SUCCESS: filechooser event captured!");
  });

  const item = page.locator('#menuItemBilan');
  await item.click();
  await page.waitForTimeout(500);

  console.log("Did filechooser fire?", fileChooserFired);
  await browser.close();
}

main().catch(console.error);
