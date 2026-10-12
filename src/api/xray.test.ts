/** INPUT: borrow / liquidate fixtures。 OUTPUT: bytes / IDL spans / 日志 / 数据库一致性断言。 POSITION: EP7 X 光测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedApi } from './test-utils';
import run from '../../fixtures/m1-run.json';
import { marginfiIdl } from '../decoder/idl';
import { decodeFields } from '../decoder/borsh';
import { Reader } from '../core/reader';
import { toJson } from '../store/json';
import { getXray } from './xray';
import { byteSpans } from './spans';
import { decodeEvents } from '../decoder/event';
import type { RpcTransaction } from '../decoder/transaction';
test('borrow and liquidate xray joins RPC bytes, fields, original base64 logs, and raw rows',async()=>{
 const db=await seedApi();try {
  for(const title of ['bob borrow 5000 tUSDC','carol liquidate bob 10 tSOL']){
   const signature=run.steps.find(s=>s.label===title)!.signatures[0], view=await getXray(db,signature);assert.ok(view);
   const raw=(await db.query('SELECT tx FROM raw_tx WHERE signature=$1',[signature])).rows[0].tx as RpcTransaction;
   const ix=view.instructions.find(i=>i.program===marginfiIdl.address)!;const bytes=Buffer.from(ix.data_hex,'hex');let offset=0;
   for(const span of ix.spans){assert.equal(span.offset,offset);assert.equal(span.hex,bytes.subarray(offset,offset+span.length).toString('hex'));offset+=span.length;}
   assert.equal(offset,bytes.length);assert.equal(ix.spans.length,1+marginfiIdl.instructions.find(i=>i.name===ix.name)!.args.length);
   const args=decodeFields(marginfiIdl.instructions.find(i=>i.name===ix.name)!.args,new Reader(bytes.subarray(8)),marginfiIdl);
   assert.deepEqual(JSON.parse(toJson(args)),ix.args);
   assert.deepEqual(view.rows.instructions,(await db.query('SELECT * FROM instructions WHERE signature=$1 ORDER BY ix_index,inner_index',[signature])).rows);
   for(const event of view.events){assert.equal(view.logs[event.log_index],`Program data: ${event.base64}`);
    const decoded=decodeEvents(raw,marginfiIdl).events.find(e=>e.logIndex===event.log_index)!;assert.deepEqual(JSON.parse(toJson(decoded.data)),event.data);
   }
   assert.equal(view.events.length,view.rows.events.length);
  }
  assert.equal(await getXray(db,'missing'),null);
  const unknown=byteSpans(Buffer.alloc(13,255));assert.equal(unknown.reduce((n,s)=>n+s.length,0),13);
  const definition=marginfiIdl.instructions.find(i=>i.name==='lending_account_borrow')!;
  assert.throws(()=>byteSpans(Buffer.from(definition.discriminator)));
 }finally{await db.close();}
});
test('IDL spans handle compound/variable arguments and synthetic v0 inner instructions retain raw position',async()=>{
 const db=await seedApi();try {
  const rows=(await db.query('SELECT tx FROM raw_tx')).rows;
  for(const row of rows){const raw=row.tx as RpcTransaction;const view=await getXray(db,raw.transaction.signatures[0]);assert.ok(view);
   for(const i of view.instructions.filter(i=>i.program===marginfiIdl.address)){
    const bytes=Buffer.from(i.data_hex,'hex');assert.equal(i.spans.reduce((n,s)=>n+s.length,0),bytes.length);
    const def=marginfiIdl.instructions.find(d=>d.name===i.name)!;assert.deepEqual(i.spans.slice(1).map(s=>s.label),def.args.map(a=>a.name));
   }
  }
  const raw=structuredClone(rows.map(r=>r.tx as RpcTransaction).find(r=>r.transaction.signatures[0]===run.steps.find(s=>s.label==='bob borrow 5000 tUSDC')!.signatures[0])!);
  raw.transaction.signatures=['synthetic'];const message=raw.transaction.message;
  const protocolIx=message.instructions.find(i=>message.accountKeys[i.programIdIndex]===marginfiIdl.address)!;
  message.instructions=[{programIdIndex:0,accounts:[],data:''}];
  raw.meta!.loadedAddresses={writable:[marginfiIdl.address],readonly:[]};
  raw.meta!.innerInstructions=[{index:0,instructions:[{...protocolIx,programIdIndex:message.accountKeys.length}]}];
  raw.meta!.logMessages=[];
  const {insertRawTx}=await import('../store/raw'),{decodePending}=await import('../store/decode');
  await insertRawTx(db,{...raw,slot:123,blockTime:null});await decodePending(db,marginfiIdl);
  const view=await getXray(db,'synthetic');assert.ok(view);assert.equal(view.instructions[1].inner_index,0);assert.equal(view.instructions[1].ix_index,0);assert.equal(view.instructions[1].name,'lending_account_borrow');assert.deepEqual(view.instructions[1].args,{amount:'5000000000'});
  assert.equal(view.instructions[0].name,'unknown');assert.equal(view.instructions[0].data_base58,'');
  const idl={address:'',instructions:[{name:'variable',discriminator:[1,2,3,4,5,6,7,8],accounts:[],args:[{name:'optional',type:{option:'u64'}},{name:'text',type:'string'},{name:'tail',type:'bool'}]}]} as import('../decoder/idl').Idl;
  const bytes=Buffer.alloc(8+1+8+4+3+1);Buffer.from(idl.instructions[0].discriminator).copy(bytes);bytes[8]=1;bytes.writeBigUInt64LE(9007199254740993n,9);bytes.writeUInt32LE(3,17);bytes.write('abc',21);bytes[24]=1;
  const spans=byteSpans(bytes,idl);assert.deepEqual(spans.map(s=>s.length),[8,9,7,1]);assert.deepEqual(spans.slice(1).map(s=>s.value),['9007199254740993','abc',true]);
  assert.throws(()=>byteSpans(Buffer.concat([bytes,Buffer.from([0])]),idl),/trailing/);
 }finally{await db.close();}
});

// 真实联调时发现：JSONB 不保留键顺序，X 光里清算指令的账户顺序被打乱成 group, signer, liab_bank…
// 账户在指令里的位置是有语义的，必须按 IDL 声明的顺序给前端。
import { accountNames } from '../decoder/instruction';
test('X 光里的账户与参数按 IDL 声明的顺序，而不是 JSONB 的键顺序', async () => {
  const db = await seedApi();
  try {
    const signature = run.steps.find(s => s.label.includes('liquidate'))!.signatures[0];
    const view = (await getXray(db, signature))!;
    const ix = view.instructions.find(i => i.name === 'lending_account_liquidate')!;
    const entry = marginfiIdl.instructions.find(i => i.name === 'lending_account_liquidate')!;
    assert.deepEqual(Object.keys(ix.accounts), accountNames(entry.accounts));
    assert.equal(Object.keys(ix.accounts)[0], 'group');
    assert.equal(Object.keys(ix.accounts)[1], 'asset_bank');
    assert.deepEqual(Object.keys(ix.args), entry.args.map(a => a.name));
  } finally { await db.close(); }
});
