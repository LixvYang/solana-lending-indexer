import anchor from '@coral-xyz/anchor';
import type { Token } from './actors';

const { BN } = anchor;

export function fixed(numerator: number, denominator = 1) {
  const value = BigInt(numerator) * (1n << 48n) / BigInt(denominator);
  const bytes = Buffer.alloc(16);
  bytes.writeBigUInt64LE(value & ((1n << 64n) - 1n));
  bytes.writeBigUInt64LE(value >> 64n, 8);
  return { value: [...bytes] };
}

export function bankConfig(token: Token) {
  // 来源: program/.upstream/tests/utils/types.ts 的 defaultBankConfig / defaultInterestRateConfigRaw。
  // tSOL=$100: 100*100*.8 > 5000*1.1；降到 $50: 100*50*.9 < 5000*1.05。
  return {
    assetWeightInit: token === 'tSOL' ? fixed(8, 10) : fixed(1),
    assetWeightMaint: token === 'tSOL' ? fixed(9, 10) : fixed(1),
    liabilityWeightInit: fixed(11, 10), liabilityWeightMaint: fixed(105, 100),
    depositLimit: new BN('1000000000000000'), borrowLimit: new BN('1000000000000000'),
    interestRateConfig: {
      optimalUtilizationRate: fixed(5, 10), plateauInterestRate: fixed(6, 10), maxInterestRate: fixed(3),
      insuranceFeeFixedApr: fixed(1, 100), insuranceIrFee: fixed(2, 100),
      protocolFixedFeeApr: fixed(3, 100), protocolIrFee: fixed(4, 100),
      // 避免借款事件只报告到账数量、却隐藏开仓费导致净流量不一致。
      protocolOriginationFee: fixed(0),
    },
    operationalState: { operational: {} }, riskTier: { collateral: {} }, assetTag: 0,
    pad0: Array(6).fill(0), totalAssetValueInitLimit: new BN('1000000000000'), oracleMaxAge: 240,
  };
}
