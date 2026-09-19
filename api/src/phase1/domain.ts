import { BadRequestException } from '@nestjs/common';

export function availableSupply(totalSupply: number, soldCount: number) {
  return Math.max(0, totalSupply - soldCount);
}

export function requireAvailableSupply(totalSupply: number, soldCount: number, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('Số lượng NFT không hợp lệ');
  if (availableSupply(totalSupply, soldCount) < quantity) throw new BadRequestException('Không đủ NFT khả dụng');
}
