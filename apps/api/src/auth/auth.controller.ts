import { Body, Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CurrentUser, Public } from '../common/auth.decorators.js';
import { User } from '../users/user.entity.js';
import { ChangePasswordDto, LoginDto, UpdateProfileDto } from './auth.dto.js';
import { AUTH_COOKIE } from './auth.guard.js';
import { AuthService } from './auth.service.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto.identifier, dto.password);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE') === 'true',
      maxAge: SEVEN_DAYS_MS,
      path: '/',
    });
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return user;
  }

  @Patch('me')
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto);
  }
}
