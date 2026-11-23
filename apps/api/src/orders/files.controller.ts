import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';
import { ALLOWED_MIME_TYPES, FileStorage, MAX_UPLOAD_BYTES } from './file-storage.js';
import { StoredFile } from './order.entities.js';

interface Upload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller('files')
@Roles(Role.ADMIN, Role.REP)
export class FilesController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: FileStorage,
  ) {}

  /** Step 1 of attaching anything: upload the file, then reference its id (order document, payment). */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, defParamCharset: 'utf8' }))
  async upload(@CurrentUser() user: User, @UploadedFile() file: Upload | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the file as "file"');
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Only PDF, images, Excel or Word files can be attached');
    }
    const storageKey = await this.storage.put(file.buffer, file.originalname);
    const saved = await this.dataSource.getRepository(StoredFile).save({
      storageKey,
      originalName: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
      size: file.size,
      uploadedById: user.id,
    });
    const { storageKey: _key, ...rest } = saved;
    return rest;
  }

  @Get(':id')
  async download(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.dataSource
      .getRepository(StoredFile)
      .createQueryBuilder('f')
      .addSelect('f.storageKey')
      .where('f.id = :id', { id })
      .getOne();
    if (!file || !(await this.mayRead(user, file))) throw new NotFoundException('File not found');
    if (!(await this.storage.exists(file.storageKey))) throw new NotFoundException('The file is missing from storage');

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.originalName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(await this.storage.read(file.storageKey));
  }

  /** Admins, the uploader, or the rep of the client whose order or payment uses the file. */
  private async mayRead(user: User, file: StoredFile) {
    if (user.role === Role.ADMIN || file.uploadedById === user.id) return true;
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM order_documents d
         JOIN orders o ON o.id = d."orderId" JOIN clients c ON c.id = o."clientId"
        WHERE d."fileId" = $1 AND c."repId" = $2
       UNION ALL
       SELECT 1 FROM payments p JOIN clients c ON c.id = p."clientId"
        WHERE p."fileId" = $1 AND c."repId" = $2
       LIMIT 1`,
      [file.id, user.id],
    );
    return Boolean(row);
  }
}
