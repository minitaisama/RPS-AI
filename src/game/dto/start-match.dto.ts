import { ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QueuePlayerDto } from './queue-player.dto';

export class StartMatchDto {
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => QueuePlayerDto)
  players: [QueuePlayerDto, QueuePlayerDto];
}
