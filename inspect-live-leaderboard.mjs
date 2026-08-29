import 'dotenv/config';
const url = `https://api-gateway.skymavis.com/origins/v2/season-leaderboards?milestone=3&limit=3&offset=0`;
const res = await fetch(url, { headers: { 'x-api-key': process.env.AXIE_ECHELON_API_KEY } });
console.log('status', res.status);
const text = await res.text();
console.log(text);
