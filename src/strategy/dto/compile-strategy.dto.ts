import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompileStrategyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;
}
