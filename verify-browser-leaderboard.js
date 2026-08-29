const { chromium } = require('playwright');
(async() => {
  const browser = await chromium.launch({ args: ['--headless'] });
  const page = await browser.newPage();
  const errors = [];

  page.on('pageerror', (err) => errors.push('PAGE_ERROR:' + err.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    errors.push('REQ_FAILED:' + request.url() + ':' + (failure ? failure.message : 'unknown'));
  });

  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'load', timeout: 5000 });
  await page.waitForTimeout(1200);

  const rowCount = await page.locator('#leaderboard-body tr').count();
  const bodyText = await page.locator('#leaderboard-body').innerText();

  console.log('ROWS', rowCount);
  console.log('BODY_LEN', bodyText.length);
  console.log('BODY_HEAD', JSON.stringify(bodyText.slice(0, 160)));
  console.log('ERRORS', JSON.stringify(errors));

  await browser.close();
})();
