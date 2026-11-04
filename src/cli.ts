// Admin commands until the web admin page exists.
//   npm run cli -- create-user <email> "<name>" [--admin]     (password read from SSO_PASSWORD or prompted)
//   npm run cli -- create-client "<name>" <redirect_uri> [more redirect uris] [--public]
//   npm run cli -- list-clients
//   npm run cli -- delete-client <client_id>
import { createInterface } from 'node:readline/promises';
import { createClient, deleteClient, listClients } from './clients.js';
import { migrate, pool } from './db.js';
import { createUser } from './users.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));

async function askPassword(): Promise<string> {
  if (process.env.SSO_PASSWORD) return process.env.SSO_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question('Password (min 10 chars): ');
  rl.close();
  return pw;
}

await migrate();
try {
  switch (cmd) {
    case 'create-user': {
      const [email, name = ''] = args;
      if (!email) throw new Error('Usage: create-user <email> "<name>" [--admin]');
      const user = await createUser(email, name, await askPassword(), flags.has('--admin'));
      console.log(`Created user ${user.email} (${user.id})`);
      break;
    }
    case 'create-client': {
      const [name, ...redirectUris] = args;
      if (!name || redirectUris.length === 0) throw new Error('Usage: create-client "<name>" <redirect_uri>... [--public]');
      const c = await createClient({ name, redirectUris, type: flags.has('--public') ? 'public' : 'confidential' });
      console.log(`client_id:     ${c.clientId}`);
      if (c.clientSecret) console.log(`client_secret: ${c.clientSecret}   (save it now in the app config)`);
      break;
    }
    case 'list-clients':
      console.table(await listClients());
      break;
    case 'delete-client':
      await deleteClient(args[0]!);
      console.log('Deleted');
      break;
    default:
      console.log('Commands: create-user, create-client, list-clients, delete-client');
  }
} finally {
  await pool.end();
}
