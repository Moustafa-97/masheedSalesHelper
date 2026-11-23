import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { QueryFailedError, Repository } from 'typeorm';
import { hashPassword, normalizePhone } from '../auth/password.js';
import { Roles } from '../common/auth.decorators.js';
import { Role, User } from './user.entity.js';

export class CreateUserDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
  /** Required for CLIENT users. */
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

export const isUniqueViolation = (e: unknown) =>
  e instanceof QueryFailedError && (e as any).driverError?.code === '23505';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  list() {
    return this.users.find({ order: { role: 'ASC', name: 'ASC' } });
  }

  async create(dto: CreateUserDto) {
    if (!dto.email && !dto.phone) throw new BadRequestException('Email or phone is required');
    if (dto.role === Role.CLIENT && !dto.clientId)
      throw new BadRequestException('clientId is required for client users');
    try {
      const user = await this.users.save(
        this.users.create({
          name: dto.name,
          email: dto.email?.toLowerCase() ?? null,
          phone: dto.phone ? normalizePhone(dto.phone) : null,
          passwordHash: await hashPassword(dto.password),
          role: dto.role,
          jobTitle: dto.jobTitle ?? null,
          clientId: dto.role === Role.CLIENT ? dto.clientId : null,
          locale: dto.locale ?? 'ar',
        }),
      );
      return this.users.findOneByOrFail({ id: user.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Email or phone already in use');
      throw e;
    }
  }

  async update(id: string, dto: UpdateUserDto) {
    const changes: Partial<User> = { ...dto };
    if (dto.email) changes.email = dto.email.toLowerCase();
    if (dto.phone) changes.phone = normalizePhone(dto.phone);
    try {
      const result = await this.users.update({ id }, changes);
      if (!result.affected) throw new NotFoundException();
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Email or phone already in use');
      throw e;
    }
    return this.users.findOneByOrFail({ id });
  }

  async resetPassword(id: string, password: string) {
    const result = await this.users.update({ id }, { passwordHash: await hashPassword(password) });
    if (!result.affected) throw new NotFoundException();
  }
}

@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(id, dto.password);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
