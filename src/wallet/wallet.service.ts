import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async lockStake(playerId: string, amount: string) {
    const numAmount = parseFloat(amount || '0');
    
    await this.prisma.walletBalance.upsert({
      where: { userId: playerId },
      update: {
        balance: { decrement: numAmount },
        locked: { increment: numAmount },
      },
      create: {
        userId: playerId,
        balance: 1000 - numAmount,
        locked: numAmount,
      },
    });

    await this.prisma.walletTransaction.create({
      data: {
        userId: playerId,
        amount: -numAmount,
        type: 'LOCK_STAKE',
        status: 'COMPLETED',
      },
    });
    
    return { playerId, amount, status: 'locked' };
  }

  async settleMatch(winnerId: string, loserId: string, amount: string) {
    const numAmount = parseFloat(amount || '0');
    
    await this.prisma.$transaction([
      this.prisma.walletBalance.update({
        where: { userId: winnerId },
        data: {
          balance: { increment: numAmount * 2 },
        },
      }),
      this.prisma.walletBalance.update({
        where: { userId: loserId },
        data: {
          locked: { decrement: numAmount },
        },
      }),
      this.prisma.walletTransaction.create({
        data: {
          userId: winnerId,
          amount: numAmount * 2,
          type: 'SETTLE_WIN',
          status: 'COMPLETED',
        },
      }),
    ]);
    
    return { winnerId, loserId, amount, status: 'settled' };
  }

  async getBalance(userId: string) {
    const balance = await this.prisma.walletBalance.findUnique({
      where: { userId },
    });
    return balance || { userId, balance: 0, locked: 0 };
  }

  async getTransactions(userId: string) {
    return this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
