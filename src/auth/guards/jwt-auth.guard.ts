import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../../common/http/api-exception';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization as string | undefined;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null;

    if (!token) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Missing bearer token');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new ApiException(500, 'CONFIG_ERROR', 'JWT secret is not configured');
    }

    try {
      request.user = this.jwtService.verify(token, {
        secret,
      });
      return true;
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
  }
}
