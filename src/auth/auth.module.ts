import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { DeviceAuthGuard } from './guards/device-auth.guard';

@Module({
  providers: [AuthService, DeviceAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, DeviceAuthGuard],
})
export class AuthModule {}
