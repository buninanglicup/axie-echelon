const fetch = require('node-fetch');
(async () => {
  try {
    const url = 'https://api-gateway.skymavis.com/origins/v2/season-leaderboards?milestone=3&limit=3&offset=0';
    const res = await fetch(url);
    const body = await res.text();
    console.log('status', res.status);
    console.log(body.slice(0, 2000));
  } catch (err) {
    console.error(err && err.message ? err.message : err);
  }
})();
