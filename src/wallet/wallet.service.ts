import { Injectable } from '@nestjs/common';

@Injectable()
export class WalletService {
  async lockStake(playerId: string, amount: string) {
    return { playerId, amount, status: 'locked' };
  }

  async settleMatch(winnerId: string, loserId: string, amount: string) {
    return { winnerId, loserId, amount, status: 'settled' };
  }
}
