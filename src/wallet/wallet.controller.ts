import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { WalletService } from './wallet.service';
// Replace with actual auth guard if needed
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('wallet')
// @UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  async getBalance(@Req() req: any) {
    // Note: Assuming req.user is set by your AuthGuard
    // Provide a mocked user ID for now if no auth is in place
    const userId = req.user?.id || 'mocked-user-id';
    return this.walletService.getBalance(userId);
  }

  @Get('transactions')
  async getTransactions(@Req() req: any) {
    const userId = req.user?.id || 'mocked-user-id';
    return this.walletService.getTransactions(userId);
  }
}
