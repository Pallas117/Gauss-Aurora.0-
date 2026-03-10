import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`BROWSER ${msg.type().toUpperCase()}: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`BROWSER EXCEPTION: ${error.message}`);
  });

  console.log("Navigating to http://127.0.0.1:5176/ ...");
  await page.goto('http://127.0.0.1:5176/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await browser.close();
})();
