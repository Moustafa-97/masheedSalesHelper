import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, User } from '../users/user.entity.js';

export const IS_PUBLIC = 'isPublic';
/** Opens a route to requests without a signed-in user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restricts a route to the given roles. No @Roles() = any signed-in user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The signed-in user, loaded from the database on every request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User =>
    ctx.switchToHttp().getRequest().user,
);
