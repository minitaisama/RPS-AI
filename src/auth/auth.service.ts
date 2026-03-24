import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { WalletVerifyDto } from './dto/wallet-verify.dto';
import { WalletLoginDto } from './dto/wallet-login.dto';
import { ApiException } from '../common/http/api-exception';
import { verifyMessage } from 'ethers';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  private get redis() {
    return this.redisService.getClient();
  }

  private getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    return secret;
  }

  private normalizeWallet(walletAddress: string) {
    return walletAddress.toLowerCase();
  }

  async login(dto: WalletLoginDto) {
    const walletAddress = this.normalizeWallet(dto.walletAddress);
    const nonce = `rps-login:${crypto.randomUUID()}`;
    await this.redis.set(`rps:auth:nonce:${walletAddress}:${nonce}`, nonce, 'EX', 60 * 10);

    return {
      nonce,
      walletAddress,
    };
  }

  async verifyWallet(dto: WalletVerifyDto) {
    const walletAddress = this.normalizeWallet(dto.walletAddress);
    const nonceKey = `rps:auth:nonce:${walletAddress}:${dto.nonce}`;
    const storedNonce = await this.redis.get(nonceKey);

    if (!storedNonce || storedNonce !== dto.nonce) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Invalid or expired nonce');
    }

    try {
      const signer = verifyMessage(dto.nonce, dto.signature).toLowerCase();
      if (signer !== walletAddress) {
        throw new Error('signature mismatch');
      }
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED', 'Wallet signature verification failed');
    }

    await this.redis.del(nonceKey);

    const user = await this.prisma.user.upsert({
      where: { walletAddress },
      update: {},
      create: { walletAddress },
    });

    return this.issueTokens(user.id, user.walletAddress, user);
  }

  async refresh(refreshToken: string) {
    const secret = this.getJwtSecret();

    let payload: { sub?: string; walletAddress?: string; type?: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret,
      });
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED', 'Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh' || !payload.sub) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Invalid refresh token');
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!currentUser) {
      throw new ApiException(401, 'UNAUTHORIZED', 'User not found');
    }

    return this.issueTokens(currentUser.id, currentUser.walletAddress, currentUser);
  }

  private async issueTokens(userId: string, walletAddress: string, user: unknown) {
    const payload = { sub: userId, walletAddress };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.getJwtSecret(),
      expiresIn: '7d',
    });
    const refreshToken = await this.jwtService.signAsync(
      { ...payload, type: 'refresh' },
      {
        secret: this.getJwtSecret(),
        expiresIn: '30d',
      },
    );

    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.redis.set(`rps:auth:refresh:${userId}:${refreshTokenHash}`, '1', 'EX', 60 * 60 * 24 * 30);

    return {
      accessToken,
      refreshToken,
      user,
    };
  }
}
