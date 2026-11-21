// Every migration, in order. After `npm run migration:generate -- src/migrations/<Name>`, add the new class here.
import { Init1795287032185 } from './1795287032185-Init.js';
import { ProductCatalogue1795293848418 } from './1795293848418-ProductCatalogue.js';

export const migrations = [Init1795287032185, ProductCatalogue1795293848418];
