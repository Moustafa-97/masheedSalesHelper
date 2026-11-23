import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity.js';
import { ChangePasswordDto, UpdateProfileDto } from './auth.dto.js';
import { hashPassword, normalizePhone, verifyPassword } from './password.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async login(identifier: string, password: string) {
    const id = identifier.trim();
    const where = id.includes('@')
      ? { email: id.toLowerCase(), isActive: true }
      : { phone: normalizePhone(id), isActive: true };
    const user = await this.users.findOne({
      where,
      select: { id: true, passwordHash: true },
    });
    // Always run the hash check, so unknown logins and wrong passwords take the same time.
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');

    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, user: await this.users.findOneByOrFail({ id: user.id }) };
  }

  async updateProfile(user: User, dto: UpdateProfileDto) {
    const changes: Partial<User> = { ...dto };
    if (dto.email) changes.email = dto.email.toLowerCase();
    if (dto.phone) changes.phone = normalizePhone(dto.phone);
    await this.users.update({ id: user.id }, changes);
    return this.users.findOneByOrFail({ id: user.id });
  }

  async changePassword(user: User, dto: ChangePasswordDto) {
    const found = await this.users.findOne({
      where: { id: user.id },
      select: { id: true, passwordHash: true },
    });
    if (!(await verifyPassword(dto.currentPassword, found?.passwordHash)))
      throw new BadRequestException('Current password is wrong');
    await this.users.update({ id: user.id }, { passwordHash: await hashPassword(dto.newPassword) });
  }
}
