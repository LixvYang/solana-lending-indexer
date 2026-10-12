/** INPUT: DATABASE_URL / PORT。 OUTPUT: 只读 API 服务（默认 8787）。 POSITION: EP7 CLI，无 RPC。 SYNC: 同步 folder.md。 */
import 'dotenv/config';
import { pgDb } from '../src/store/db';
import { createApiServer, portNumber } from '../src/api/server';
function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('用法: serve-api (PORT 默认 8787)');
    return;
  }
  if (args.length)
    throw new Error('invalid arguments');
  const port = portNumber(process.env.PORT), db = pgDb(), server = createApiServer(db);
  server.on('error', () => { console.error('API server failed'); void db.close(); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`API listening on http://localhost:${port}`));
  const stop = () => server.close(() => { void db.close(); });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
try {
  main();
}
catch {
  console.error('API startup failed; check arguments and PORT');
  process.exitCode = 1;
}
