import { PrismaClient } from '@prisma/client';
import { seedMindoGenesisProduct } from './product-seed';

const prisma = new PrismaClient();

seedMindoGenesisProduct(prisma)
  .then((product) => console.log(`Seeded product ${product.name} (${product.id})`))
  .finally(() => prisma.$disconnect());
