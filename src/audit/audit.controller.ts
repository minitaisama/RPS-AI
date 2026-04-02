import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('match/:matchId')
  async getMatchAudit(@Param('matchId') matchId: string) {
    return this.auditService.getMatchAudit(matchId);
  }

  @Get('logs')
  async getLogs(@Query('limit') limit?: number) {
    return this.auditService.getRecentLogs(limit ? Number(limit) : 50);
  }
}
