const { Client } = require('pg');
const fs = require('fs');

async function run() {
    const envText = fs.readFileSync('.env.prod.verify', 'utf8');
    const dbMatch = envText.match(/DATABASE_URL="([^"]+)"/);
    const dbUrl = dbMatch ? dbMatch[1] : '';

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    const res = await client.query("DELETE FROM cards WHERE email='bot@asg.dev' RETURNING id, card_id;");
    console.log("Deleted test cards:", res.rows);
    await client.end();
}
run();
