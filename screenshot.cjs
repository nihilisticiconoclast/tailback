const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8000/');

  // Wait a bit for the simulation to start and create a cascade
  await page.waitForTimeout(5000);

  // Try to increase traffic density or whatever causes large tailbacks
  await page.evaluate(() => {
    // We could adjust parameters here if needed
  });

  await page.waitForTimeout(10000);

  await page.screenshot({ path: 'test_fixed.png' });
  await browser.close();
})();
