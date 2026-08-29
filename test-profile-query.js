import 'dotenv/config';

const apiKey = process.env.AXIE_ECHELON_API_KEY;
const accountId = '1ec9eb6f-4702-677d-a60c-5b43771e8057';

const query = `query GetProfileByID($accountId: UUID!) {
  publicProfile(id: $accountId) {
    accountId
    name
    addresses {
      ronin
    }
  }
}`;

const body = JSON.stringify({
  operationName: 'GetProfileByID',
  variables: { accountId },
  query
});

fetch('https://api-gateway.skymavis.com/graphql/axie-marketplace', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-api-key': apiKey
  },
  body
})
  .then(async (r) => {
    const text = await r.text();
    console.log('status=' + r.status);
    console.log(text);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
