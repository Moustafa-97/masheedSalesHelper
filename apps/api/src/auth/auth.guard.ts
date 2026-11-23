import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { IS_PUBLIC, ROLES } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';

export const AUTH_COOKIE = 'access_token';

/**
 * Global guard: every route needs a valid session cookie (or Bearer token)
 * unless marked @Public(). The user is reloaded from the database each time,
 * so a deactivated user or a role change takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: User }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException();

    // A cookie that no longer works (expired, wrong secret, user deleted or deactivated, or from
    // another database) is removed, so the web app's "signed in" check doesn't keep bouncing to /login.
    const reject = () => {
      context.switchToHttp().getResponse<Response>().clearCookie(AUTH_COOKIE, { path: '/' });
      return new UnauthorizedException();
    };

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw reject();
    }

    const user = await this.users.findOneBy({ id: payload.sub, isActive: true });
    if (!user) throw reject();
    request.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const fromCookie = request.cookies?.[AUTH_COOKIE];
    if (fromCookie) return fromCookie;
    const [type, value] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? value : undefined;
  }
}
