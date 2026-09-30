import { PrismaClient } from '@prisma/client';

export const mindoGenesisProduct = {
  name: 'Mindo Genesis',
  symbol: 'MND',
  description: 'NFT chứng nhận hạng Tinh hoa, liên kết mã MND. Giao dịch nội bộ trên hệ thống Mindo, miễn phí giao dịch.',
  imageUrl: 'https://admin-mindo.stg-studio.com/mindo-genesis.svg',
  metadataBaseUrl: 'https://api-mindo.stg-studio.com/metadata/mindo-genesis',
  unitPriceVnd: '25000000',
  totalSupply: 500,
  isActive: true,
} as const;

export async function seedMindoGenesisProduct(prisma: PrismaClient) {
  // Tìm cả mã cũ để seed trên môi trường đã có dữ liệu vẫn cập nhật đúng
  // sản phẩm, không tạo thêm một dòng trùng tên.
  const existing = await prisma.nftProduct.findFirst({
    where: {
      OR: [
        { name: mindoGenesisProduct.name },
        { symbol: { in: ['MND', 'MINDO'] } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  return existing
    ? prisma.nftProduct.update({ where: { id: existing.id }, data: mindoGenesisProduct })
    : prisma.nftProduct.create({ data: mindoGenesisProduct });
}
