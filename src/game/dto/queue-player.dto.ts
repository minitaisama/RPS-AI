import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class QueuePlayerDto {
  @IsUUID()
  playerId: string;

  @IsOptional()
  @IsUUID()
  strategyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;

  @IsOptional()
  @IsString()
  preset?: string;
}
