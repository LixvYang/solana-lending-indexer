/** INPUT: 真实未 crank fixture / 合成价格区。 OUTPUT: PullFeed 精确解码断言。 POSITION: EP7 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePullFeed, OFFSET, FEED_SIZE, DISCRIMINATOR } from './switchboard';
import { resultRegion } from '../../scenario/lib/mock-feed';
test('real uncranked feed and mock 100 decode with exact value/time/slot',()=>{
  const bytes=readFileSync('fixtures/switchboard-pullfeed-uncranked.bin');
  const zero=decodePullFeed(bytes); assert.equal(zero.price.number,0); assert.equal(zero.price.decimal,'0');
  assert.equal(zero.authority,'6LzQJAR4A7KRcSHYhBhXdv4pcUuzAQtAfMMhoGDZ8NL9');
  assert.equal(zero.queue,'EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7');
  const mock=Buffer.from(bytes); resultRegion(100,1700000000,12345).copy(mock,OFFSET.sampleSize);
  const value=decodePullFeed(mock); assert.equal(value.price.number,100); assert.equal(value.price.decimal,'100');
  assert.equal(value.price.numerator,100n*10n**18n); assert.equal(value.price.denominator,10n**18n);
  assert.equal(value.std_dev.number,0); assert.equal(value.slot,12345n); assert.equal(value.last_update_timestamp,1700000000n); assert.equal(value.sample_size,1);
  assert.equal(value.feed_hash,bytes.subarray(OFFSET.feedHash,OFFSET.feedHash+32).toString('hex'));
  const tiny=Buffer.alloc(FEED_SIZE); DISCRIMINATOR.copy(tiny); tiny.writeBigUInt64LE(1n,OFFSET.result);
  assert.equal(decodePullFeed(tiny).price.decimal,'0.000000000000000001');
  assert.throws(()=>decodePullFeed(mock.subarray(1))); mock[0]^=1; assert.throws(()=>decodePullFeed(mock));
});
