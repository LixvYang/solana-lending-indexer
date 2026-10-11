import * as mock from './mock-feed';
import * as real from './switchboard';

// 价格来源由 PRICE_PROVIDER 选择，默认 mock-switchboard。
// 原因：devnet 的 Switchboard oracle 目前离线(docs/decisions.md D-008)。oracle 恢复后，
// 把 marginfi 以 PRICE_ORACLE=switchboard 重新构建部署，并设 PRICE_PROVIDER=switchboard 即可切回。
const provider = () => (process.env.PRICE_PROVIDER === 'switchboard' ? real : mock);

export const createOrUpdateFeed: typeof real.createOrUpdateFeed = (...args) => provider().createOrUpdateFeed(...args);
export const crank: typeof real.crank = (...args) => provider().crank(...args);
export const changePrice: typeof real.changePrice = (...args) => provider().changePrice(...args);
