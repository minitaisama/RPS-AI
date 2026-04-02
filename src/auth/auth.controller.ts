import { Controller, Delete, Get, Req, UseGuards } from '@nestjs/common';
import { DeviceAuthGuard } from './guards/device-auth.guard';

@Controller('auth')
@UseGuards(DeviceAuthGuard)
export class AuthController {
  @Get('me')
  me(@Req() req: any) {
    return {
      user: {
        id: req.user.sub,
        displayName: req.user.displayName,
      },
    };
  }

  @Delete('me')
  logout() {
    return { success: true };
  }
}
