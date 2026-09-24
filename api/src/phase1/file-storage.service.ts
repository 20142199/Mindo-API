import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { FileUpload } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../common/prisma.module';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

@Injectable()
export class FileStorageService {
  private readonly baseDir = path.resolve(process.env.FILE_STORAGE_DIR ?? './storage/kyc');

  constructor(private readonly prisma: PrismaService) {}

  async save(ownerId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Vui lòng chọn file cần tải lên');
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) throw new BadRequestException('Chỉ hỗ trợ JPG, PNG, WebP hoặc PDF');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('File không được vượt quá 10 MB');

    const extension = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
    const storedName = `${randomUUID()}${extension}`;
    const ownerDir = path.join(this.baseDir, ownerId);
    const target = path.join(ownerDir, storedName);
    await mkdir(ownerDir, { recursive: true });
    await writeFile(target, file.buffer, { flag: 'wx' });
    try {
      const row = await this.prisma.fileUpload.create({
        data: { ownerId, originalName: file.originalname.slice(0, 255), storedName, mimeType: file.mimetype, size: file.size },
      });
      return this.view(row);
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }
  }

  async assertOwned(ownerId: string, fileId: string) {
    const file = await this.prisma.fileUpload.findUnique({ where: { id: fileId } });
    if (!file || file.ownerId !== ownerId) throw new BadRequestException('File không hợp lệ');
    return file;
  }

  async readOwned(ownerId: string, fileId: string) {
    const file = await this.assertOwned(ownerId, fileId);
    const target = path.resolve(this.baseDir, file.ownerId, file.storedName);
    if (!target.startsWith(this.baseDir + path.sep)) throw new UnauthorizedException('Đường dẫn file không hợp lệ');
    return { file, content: await readFile(target) };
  }

  async resolveSignedContent(id: string, expiresValue: string, signature: string) {
    const expires = Number(expiresValue);
    if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Liên kết file đã hết hạn');
    }
    const expected = this.signature(id, expires);
    const supplied = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) {
      throw new UnauthorizedException('Liên kết file không hợp lệ');
    }
    const file = await this.prisma.fileUpload.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('File không tồn tại');
    const target = path.resolve(this.baseDir, file.ownerId, file.storedName);
    if (!target.startsWith(this.baseDir + path.sep)) throw new UnauthorizedException('Đường dẫn file không hợp lệ');
    return { file, content: await readFile(target) };
  }

  view(file: FileUpload) {
    const ttl = Math.max(60, Number(process.env.FILE_URL_TTL_SECONDS ?? 900));
    // Giữ URL ổn định trong cùng một cửa sổ TTL để polling/SSE không phát lại
    // chỉ vì chữ ký của file thay đổi từng giây.
    const expires = (Math.floor(Date.now() / 1000 / ttl) + 2) * ttl;
    const baseUrl = (process.env.APP_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const publicUrl = `${baseUrl}/api/v1/files/${file.id}/content?expires=${expires}&signature=${this.signature(file.id, expires)}`;
    return {
      id: file.id,
      name: file.originalName,
      mime_type: file.mimeType,
      size: file.size,
      visibility: 'private',
      url: publicUrl,
      public_url: publicUrl,
      uploaded_at: file.createdAt.getTime(),
    };
  }

  private signature(id: string, expires: number) {
    const secret = process.env.FILE_URL_SIGNING_SECRET ?? process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('FILE_URL_SIGNING_SECRET chưa được cấu hình');
    return createHmac('sha256', secret).update(`${id}:${expires}`).digest('hex');
  }
}
