// Every migration, in order. After `npm run migration:generate -- src/migrations/<Name>`, add the new class here.
import { Init1795287032185 } from './1795287032185-Init.js';
import { ProductCatalogue1795293848418 } from './1795293848418-ProductCatalogue.js';
import { Orders1795452385702 } from './1795452385702-Orders.js';
import { PaymentMethods1795625143093 } from './1795625143093-PaymentMethods.js';
import { ChequeApproval1795625784083 } from './1795625784083-ChequeApproval.js';
import { Guarantees1795627395114 } from './1795627395114-Guarantees.js';

export const migrations = [Init1795287032185, ProductCatalogue1795293848418, Orders1795452385702, PaymentMethods1795625143093, ChequeApproval1795625784083, Guarantees1795627395114];
