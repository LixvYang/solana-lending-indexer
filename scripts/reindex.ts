/** INPUT: DATABASE_URL、固定 IDL、已入库事实。 OUTPUT: 重建命令。 POSITION: EP6 无 RPC 的重放入口。 SYNC: 同步 folder.md。 */
import { runStoreCommand, reportError } from './store-command';
import { rebuildDecoded } from '../src/store/decode';
import { marginfiIdl } from '../src/decoder/idl';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log('用法: reindex');
else if (args.length) reportError(new Error('用法: reindex'));
else void runStoreCommand(async db => { console.log(`rebuilt ${await rebuildDecoded(db, marginfiIdl)} transactions`); }).catch(reportError);
