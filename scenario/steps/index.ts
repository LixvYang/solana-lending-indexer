import { step as mints } from './01-mints';
import { step as feeds } from './02-feeds';
import { step as group } from './03-group';
import { step as banks } from './04-banks';
import { step as accounts } from './05-accounts';
import { step as aliceDeposit } from './06-alice-deposit';
import { step as bobDeposit } from './07-bob-deposit';
import { step as bobBorrow } from './08-bob-borrow';
import { step as interest } from './09-interest';
import { step as priceDrop } from './10-price-drop';
import { step as liquidation } from './11-liquidation';
import { step as withdrawRepay } from './12-withdraw-repay';
import type { Step } from '../lib/context';

export const steps: Step[] = [mints, feeds, group, banks, accounts, aliceDeposit,
  bobDeposit, bobBorrow, interest, priceDrop, liquidation, withdrawRepay];
