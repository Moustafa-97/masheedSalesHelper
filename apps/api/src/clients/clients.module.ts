import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { normalizePhone } from '../auth/password.js';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { Client, ClientStatus } from './client.entity.js';

class ClientFieldsDto {
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MaxLength(20) crNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) vatNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) purchasingName?: string;
  @IsOptional() @IsString() @MaxLength(32) purchasingPhone?: string;
  @IsOptional() @IsEmail() purchasingEmail?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  // Credit terms: only an admin may set them (checked in the service).
  @IsOptional() @IsIn([0, 30, 45, 60, 90]) paymentTermsDays?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) creditLimit?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) openingBalance?: number;
  /** Admin only: which rep owns the client. Defaults to the creator. */
  @IsOptional() @IsUUID() repId?: string;
}

export class CreateClientDto extends ClientFieldsDto {
  @IsString() @MaxLength(200) name: string;
}

export class UpdateClientDto extends ClientFieldsDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
}

export class ListClientsQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

const ADMIN_ONLY_FIELDS = ['paymentTermsDays', 'creditLimit', 'openingBalance', 'repId'] as const;

@Injectable()
export class ClientsService {
  constructor(@InjectRepository(Client) private readonly clients: Repository<Client>) {}

  /** Rows the user may see: admins see all, reps their own, client users their own account. */
  scope(user: User): FindOptionsWhere<Client> {
    if (user.role === Role.ADMIN) return {};
    if (user.role === Role.REP) return { repId: user.id };
    return { id: user.clientId ?? '00000000-0000-0000-0000-000000000000' };
  }

  list(user: User, query: ListClientsQuery) {
    const base: FindOptionsWhere<Client> = { ...this.scope(user) };
    if (query.status) base.status = query.status;
    const where = query.q
      ? [
          { ...base, name: ILike(`%${query.q}%`) },
          { ...base, code: ILike(`%${query.q}%`) },
        ]
      : base;
    return this.clients.find({
      where,
      order: { name: 'ASC' },
      take: Math.min(query.limit ?? 200, 500),
      relations: { rep: true },
    });
  }

  async get(user: User, id: string) {
    const client = await this.clients.findOne({
      where: { ...this.scope(user), id },
      relations: { rep: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async create(user: User, dto: CreateClientDto) {
    this.assertAllowedFields(user, dto);
    try {
      const saved = await this.clients.save(
        this.clients.create({
          ...this.normalize(dto),
          repId: user.role === Role.ADMIN && dto.repId ? dto.repId : user.id,
        }),
      );
      return this.get(user, saved.id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Client code already exists');
      throw e;
    }
  }

  async update(user: User, id: string, dto: UpdateClientDto) {
    this.assertAllowedFields(user, dto);
    try {
      const result = await this.clients.update({ ...this.scope(user), id }, this.normalize(dto));
      if (!result.affected) throw new NotFoundException('Client not found');
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Client code already exists');
      throw e;
    }
    return this.get(user, id);
  }

  private assertAllowedFields(user: User, dto: ClientFieldsDto) {
    if (user.role === Role.ADMIN) return;
    const blocked = ADMIN_ONLY_FIELDS.filter((f) => dto[f] !== undefined);
    if (blocked.length) throw new ForbiddenException(`Only an admin can set: ${blocked.join(', ')}`);
  }

  private normalize<T extends ClientFieldsDto>(dto: T): T {
    const out = { ...dto };
    if (dto.purchasingPhone) out.purchasingPhone = normalizePhone(dto.purchasingPhone);
    if (dto.purchasingEmail) out.purchasingEmail = dto.purchasingEmail.toLowerCase();
    if (dto.code === '') out.code = undefined;
    return out;
  }
}

@Controller('clients')
@Roles(Role.ADMIN, Role.REP)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: ListClientsQuery) {
    return this.clients.list(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateClientDto) {
    return this.clients.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clients.update(user, id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Client])],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
