const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const m = env.match(/SUPABASE_PWORD=(.+)/);
if (!m) {
  console.error("SUPABASE_PWORD not found in .env");
  process.exit(1);
}
const password = m[1].trim().replace(/^["']|["']$/g, "");
const ref = "ayicngoasguoqegxoptd";

const configs = [
  {
    host: "db." + ref + ".supabase.co",
    port: 5432,
    user: "postgres",
    ssl: { rejectUnauthorized: false },
  },
  {
    host: "aws-0-us-east-1.pooler.supabase.com",
    port: 6543,
    user: "postgres." + ref,
    ssl: { rejectUnauthorized: false },
  },
  {
    host: "aws-0-us-west-2.pooler.supabase.com",
    port: 6543,
    user: "postgres." + ref,
    ssl: { rejectUnauthorized: false },
  },
  {
    host: "aws-0-us-east-2.pooler.supabase.com",
    port: 6543,
    user: "postgres." + ref,
    ssl: { rejectUnauthorized: false },
  },
  {
    host: "aws-1-us-east-1.pooler.supabase.com",
    port: 6543,
    user: "postgres." + ref,
    ssl: { rejectUnauthorized: false },
  },
];

(async () => {
  for (const c of configs) {
    const client = new Client({
      host: c.host,
      port: c.port,
      database: "postgres",
      user: c.user,
      password,
      ssl: c.ssl,
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      const r = await client.query("select current_user, current_database()");
      console.log("CONNECTED", JSON.stringify({ host: c.host, port: c.port, user: c.user }));
      console.log(r.rows[0]);
      await client.end();
      process.exit(0);
    } catch (e) {
      console.log("FAIL", c.host, e.code || "", String(e.message).slice(0, 160));
      try {
        await client.end();
      } catch (_) {}
    }
  }
  process.exit(1);
})();
