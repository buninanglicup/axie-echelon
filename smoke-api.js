const base = 'http://127.0.0.1:8787';

async function getJson(path) {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  console.log('GET', path, 'STATUS', response.status);
  console.log(text);
  return response;
}

async function postJson(path, payload) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  console.log('POST', path, 'STATUS', response.status);
  console.log(text);
  return response;
}

(async () => {
  const leaderboard = await getJson('/api/leaderboard?limit=3&offset=0');
  if (leaderboard.status !== 200) process.exitCode = 1;

  const battleLogs = await getJson('/api/player/player-01/battle-logs');
  if (battleLogs.status !== 200) process.exitCode = 1;

  const analysis = await postJson('/api/analyze-team', {
    team: [{ class: 'Beast' }, { class: 'Aqua' }, { class: 'Plant' }]
  });

  if (analysis.status !== 200) process.exitCode = 1;
})();
