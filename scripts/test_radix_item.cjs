const { chromium } = require('/Users/guillaumephilippe/ANTIGRAVITY/compta/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Let's create a simple HTML test page with Radix or standard dropdown
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <input type="file" id="targetFile" style="display:none" onchange="console.log('FILE CHANGED')" />
      <div id="menuContent" style="padding: 20px; background: #eee;">
        <!-- Test 1: label wrapping hidden input inside a container -->
        <label id="labelTest" style="display:block; padding: 10px; background: white; cursor: pointer;">
          Label Test
          <input type="file" style="display:none" />
        </label>
        <!-- Test 2: button calling input.click() -->
        <button id="buttonTest" style="display:block; padding: 10px; margin-top: 10px;">
          Button Test
        </button>
      </div>
      <script>
        document.getElementById('buttonTest').addEventListener('click', () => {
          document.getElementById('targetFile').click();
        });
      </script>
    </body>
    </html>
  `);

  let fileChooserCount = 0;
  page.on('filechooser', () => {
    fileChooserCount++;
    console.log("FileChooser triggered!");
  });

  console.log("Testing label click...");
  await page.click('#labelTest');
  console.log("After label click, fileChoosers:", fileChooserCount);

  console.log("Testing button click...");
  await page.click('#buttonTest');
  console.log("After button click, fileChoosers:", fileChooserCount);

  await browser.close();
}

main().catch(console.error);
