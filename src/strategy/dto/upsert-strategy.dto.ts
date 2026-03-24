import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertStrategyDto {
  @IsString()
  @MaxLength(64)
  name: string;

  @IsIn(['PRESET', 'CUSTOM'])
  type: 'PRESET' | 'CUSTOM';

  @IsOptional()
  @IsString()
  presetKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;
}
