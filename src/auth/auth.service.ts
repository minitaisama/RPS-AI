import { Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/http/api-exception';
import { RedisService } from '../redis/redis.service';

type RequestIdentity = {
  sub: string;
  deviceId: string;
  username: string;
  displayName: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  private get redis() {
    return this.redisService.getClient();
  }

  private normalizeUsername(username: string) {
    const normalized = username.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (!normalized) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Missing username');
    }
    return normalized;
  }

  private normalizeDeviceId(deviceId: string) {
    const normalized = deviceId.trim();
    if (!normalized) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Missing device id');
    }
    return normalized;
  }

  async resolveIdentity(deviceIdRaw?: string, usernameRaw?: string): Promise<RequestIdentity> {
    const deviceId = this.normalizeDeviceId(deviceIdRaw || '');
    const username = this.normalizeUsername(usernameRaw || '');
    const redisKey = `rps:device-user:${deviceId}`;
    const existingUserId = await this.redis.get(redisKey);

    let user = existingUserId
      ? await this.prisma.user.findUnique({ where: { id: existingUserId } })
      : await this.prisma.user.findFirst({ where: { displayName: username } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          displayName: username,
        },
      });
    } else if (user.displayName !== username) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { displayName: username },
      });
    }

    await this.redis.set(redisKey, user.id, 'EX', 60 * 60 * 24 * 365);

    return {
      sub: user.id,
      deviceId,
      username,
      displayName: user.displayName || username,
    };
  }

  async resolveRequestIdentity(headers: IncomingHttpHeaders): Promise<RequestIdentity> {
    const deviceIdHeader = headers['x-device-id'];
    const usernameHeader = headers['x-username'];
    const deviceId = Array.isArray(deviceIdHeader) ? deviceIdHeader[0] : deviceIdHeader;
    const username = Array.isArray(usernameHeader) ? usernameHeader[0] : usernameHeader;

    return this.resolveIdentity(deviceId, username);
  }
}
