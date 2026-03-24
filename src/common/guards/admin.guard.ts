import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiException } from '../http/api-exception';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const adminKey = request.headers['x-admin-key'];
    const expected = process.env.ADMIN_KEY || 'dev-admin-key';

    if (adminKey !== expected) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Admin access required');
    }

    return true;
  }
}
