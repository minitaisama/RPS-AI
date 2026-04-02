import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { GameService } from '../game/game.service';
import { DeviceAuthGuard } from '../auth/guards/device-auth.guard';

@Controller()
@UseGuards(DeviceAuthGuard)
export class MatchController {
  constructor(private readonly gameService: GameService) {}

  @Get('matches')
  async getMatches(
    @Req() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.gameService.getUserMatches(req.user.sub, page, limit);
  }

  @Get('matches/me')
  async getMyMatches(@Req() req: any) {
    return this.gameService.getUserMatches(req.user.sub, 1, 50);
  }

  @Get('matches/:id')
  async getMatch(@Param('id') id: string) {
    const match = await this.gameService.getMatchDetail(id);
    return {
      match,
      turns: match?.turns || [],
    };
  }

  @Get('leaderboard')
  async leaderboard(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const leaderboard = await this.gameService.getLeaderboard(page, limit);
    return {
      leaderboard,
      pagination: { page, limit },
    };
  }
}
