import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { WalletVerifyDto } from './dto/wallet-verify.dto';
import { WalletLoginDto } from './dto/wallet-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiException } from '../common/http/api-exception';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: WalletLoginDto) {
    return this.authService.login(dto);
  }

  @Post('wallet/login')
  walletLogin(@Body() dto: WalletLoginDto) {
    return this.authService.login(dto);
  }

  @Post('verify')
  verify(@Body() dto: WalletVerifyDto) {
    return this.authService.verifyWallet(dto);
  }

  @Post('wallet/verify')
  walletVerify(@Body() dto: WalletVerifyDto) {
    return this.authService.verifyWallet(dto);
  }

  @Post('refresh')
  refresh(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Refresh token required');
    }
    return this.authService.refresh(refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: any) {
    return { user: req.user };
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  logout() {
    return { success: true };
  }
}
