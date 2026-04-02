import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { UpsertStrategyDto } from './dto/upsert-strategy.dto';
import { DeviceAuthGuard } from '../auth/guards/device-auth.guard';
import { CompileStrategyDto } from './dto/compile-strategy.dto';

@Controller('strategies')
@UseGuards(DeviceAuthGuard)
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get()
  list(@Req() req: any) {
    return this.strategyService.listStrategies(req.user.sub);
  }

  @Get('active')
  active(@Req() req: any) {
    return this.strategyService.getActiveStrategy(req.user.sub);
  }

  @Post()
  create(@Req() req: any, @Body() dto: UpsertStrategyDto) {
    return this.strategyService.upsertStrategy(req.user.sub, dto);
  }

  @Get(':id')
  getById(@Req() req: any, @Param('id') id: string) {
    return this.strategyService.getStrategyForUser(req.user.sub, id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.strategyService.deleteStrategy(req.user.sub, id);
  }

  @Put(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpsertStrategyDto) {
    return this.strategyService.updateStrategy(req.user.sub, id, dto);
  }

  @Put(':id/activate')
  activate(@Req() req: any, @Param('id') id: string) {
    return this.strategyService.activateStrategy(req.user.sub, id);
  }

  @Post(':id/compile')
  compile(@Req() req: any, @Param('id') id: string, @Body() dto: CompileStrategyDto) {
    return this.strategyService.compileStrategy(req.user.sub, id, dto.prompt);
  }
}
